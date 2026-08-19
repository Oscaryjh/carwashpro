import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { malaysiaStateOptions } from "@/lib/holidays/domain";
import { listHolidayCalendar, previewOfficialHolidayCalendar } from "@/lib/holidays/service";
import { prisma } from "@/lib/prisma";
import {
  cancelHolidayAction,
  createHolidayAction,
  importOfficialHolidayCalendarAction,
  reviseHolidayAction,
  updateHolidayJurisdictionAction,
} from "./actions";
import { HolidayCalendarView } from "./holiday-calendar-view";
import { HolidayDialog } from "./holiday-dialog";
import { HolidaySourceFields } from "./holiday-source-fields";
import styles from "./holidays.module.css";

type Props = {
  searchParams: Promise<{ year?: string; type?: string; message?: string }>;
};

export const dynamic = "force-dynamic";

export default async function PublicHolidaysPage({ searchParams }: Props) {
  const { access, businessId } = await requireBusinessUser("VIEW_ROSTER");
  const [params, scope] = await Promise.all([searchParams, resolveAttendanceScope(access)]);
  const year = safeYear(params.year);
  const [branches, holidays] = await Promise.all([
    prisma.branch.findMany({
      where: { businessId, id: { in: [...scope.allowedBranchIds] }, status: "ACTIVE" },
      select: { id: true, name: true, countryCode: true, stateCode: true },
      orderBy: { name: "asc" },
    }),
    listHolidayCalendar({ businessId, year }),
  ]);
  const canManage = hasBusinessCapability(access, "MANAGE_SHIFT_TEMPLATES");
  const supportedJurisdiction = branches.find((branch) => branch.countryCode === "MY" && branch.stateCode === "SBH");
  const officialPreview = supportedJurisdiction
    ? await previewOfficialHolidayCalendar({ businessId, countryCode: supportedJurisdiction.countryCode, stateCode: supportedJurisdiction.stateCode, year })
    : null;
  const active = holidays.filter((holiday) => holiday.status === "ACTIVE");
  const historical = holidays.filter((holiday) => holiday.status !== "ACTIVE");
  const jurisdictionSummary = branches.map((branch) => `${branch.name} · ${stateLabel(branch.stateCode)}`).join(", ");

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      {params.message ? <p className={params.type === "error" ? styles.error : styles.success} role="status"><strong>{params.message}</strong></p> : null}

      {officialPreview?.missingCount ? <OfficialCalendarImportPanel canManage={canManage} preview={officialPreview} year={year} /> : null}

      <HolidayYearCalendar active={active} branches={branches} canManage={canManage} year={year} />

      <details className={styles.settingsPanel}>
        <summary>
          <div><span className={styles.settingsIcon}>⌖</span><span><strong>Holiday applicability</strong><small>{jurisdictionSummary || "No active branches"}</small></span></div>
          <span className={styles.settingsAction}>Manage settings</span>
        </summary>
        <div className={styles.settingsContent}>
          <div className={styles.settingsIntro}>
            <div><span className={styles.kicker}>BRANCH JURISDICTION</span><h2>State and territory holidays</h2></div>
            <p>Choose each branch jurisdiction once. State holidays then appear only where they apply.</p>
          </div>
          <div className={styles.branchGrid}>
            {branches.map((branch) => (
              <form action={updateHolidayJurisdictionAction} className={styles.branchCard} key={branch.id}>
                <input name="branchId" type="hidden" value={branch.id} />
                <input name="countryCode" type="hidden" value="MY" />
                <input name="year" type="hidden" value={year} />
                <div><strong>{branch.name}</strong><span>Malaysia (UTC+8)</span></div>
                <label><span>State / territory</span><select defaultValue={branch.stateCode ?? ""} disabled={!canManage} name="stateCode"><option value="">Not set</option>{malaysiaStateOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
                {canManage ? <button type="submit">Save</button> : null}
              </form>
            ))}
          </div>
        </div>
      </details>

      {historical.length ? <details className={styles.history}><summary>Version history · {historical.length}</summary><ul>{historical.map((holiday) => <li key={holiday.id}><span>{formatDate(holiday.workDate)}</span><strong>{holiday.name}</strong><em>{holiday.status} · revision {holiday.revision}</em></li>)}</ul></details> : null}
    </section>
  );
}

type OfficialPreview = NonNullable<Awaited<ReturnType<typeof previewOfficialHolidayCalendar>>>;

function OfficialCalendarImportPanel({ canManage, preview, year }: { canManage: boolean; preview: OfficialPreview; year: number }) {
  const missing = preview.entries.filter((entry) => !entry.installed);
  return (
    <section className={preview.missingCount ? styles.importPanel : `${styles.importPanel} ${styles.importComplete}`}>
      <div className={styles.importSummary}>
        <span aria-hidden="true" className={styles.importIcon}>{preview.missingCount ? "↓" : "✓"}</span>
        <div>
          <span className={styles.kicker}>OFFICIAL {preview.jurisdictionLabel.toUpperCase()} CALENDAR</span>
          <h2>{preview.missingCount ? `${preview.missingCount} official holidays ready to add` : "Official calendar is complete"}</h2>
          <p>{preview.installedCount} of {preview.entries.length} verified dates are already in Tetamu for {year}.</p>
        </div>
      </div>
      <div className={styles.importActions}>
        <a href={preview.sourceUrl} rel="noreferrer" target="_blank">View official source ↗</a>
        {canManage && preview.missingCount ? (
          <form action={importOfficialHolidayCalendarAction}>
            <input name="countryCode" type="hidden" value={preview.countryCode} />
            <input name="stateCode" type="hidden" value={preview.stateCode} />
            <input name="year" type="hidden" value={year} />
            <button type="submit">Add {preview.missingCount} missing holidays</button>
          </form>
        ) : null}
      </div>
      <details className={styles.importDetails}>
        <summary>Review official dates before adding</summary>
        <div className={styles.importDates}>
          {preview.entries.map((entry) => (
            <div className={entry.installed ? styles.importedDate : styles.missingDate} key={`${entry.workDate}-${entry.name}`}>
              <time dateTime={entry.workDate}>{formatCatalogDate(entry.workDate)}</time>
              <strong>{entry.name}</strong>
              <span>{entry.installed ? "Already added" : "Ready to add"}</span>
            </div>
          ))}
        </div>
        {missing.length ? <p className={styles.importFootnote}>Only the {missing.length} missing dates will be created. Existing holidays and corrections stay unchanged.</p> : null}
      </details>
    </section>
  );
}

type BranchOption = { id: string; name: string };
type HolidayRecord = Awaited<ReturnType<typeof listHolidayCalendar>>[number];

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthLabels = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function HolidayYearCalendar({
  active,
  branches,
  canManage,
  year,
}: {
  active: HolidayRecord[];
  branches: BranchOption[];
  canManage: boolean;
  year: number;
}) {
  const holidaysByDate = new Map<string, HolidayRecord[]>();
  for (const holiday of active) {
    const key = dateValue(holiday.workDate);
    holidaysByDate.set(key, [...(holidaysByDate.get(key) ?? []), holiday]);
  }

  return (
    <section aria-label={`${year} holiday calendar`} className={styles.calendarPanel}>
      <HolidayCalendarView year={year}>
        {monthLabels.map((month, monthIndex) => {
          const firstDay = new Date(Date.UTC(year, monthIndex, 1));
          const leadingDays = (firstDay.getUTCDay() + 6) % 7;
          const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
          return (
            <article aria-label={`${month} ${year}`} className={styles.monthCard} key={month}>
              <h3>{month}</h3>
              <div aria-hidden="true" className={styles.weekdayRow}>
                {weekdayLabels.map((weekday) => <span key={weekday}>{weekday}</span>)}
              </div>
              <div className={styles.monthDays}>
                {Array.from({ length: leadingDays }, (_, index) => <span className={styles.calendarBlank} key={`blank-${index}`} />)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                  const day = index + 1;
                  const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayHolidays = holidaysByDate.get(key) ?? [];
                  return (
                    <div className={`${styles.calendarDay} ${dayHolidays.length ? styles.calendarHolidayDay : ""}`} key={key}>
                      <span className={styles.calendarDate}>{day}</span>
                      {dayHolidays.map((holiday) => canManage ? (
                        <HolidayDialog
                          description="Review this holiday or save a correction as a new audited version."
                          key={holiday.id}
                          title={`Manage ${holiday.name}`}
                          triggerLabel={
                            <span className={styles.calendarHolidayContent}>
                              <strong>{holiday.name}</strong>
                              <small>{holiday.source === "OFFICIAL" ? "Official holiday" : "Company holiday"}</small>
                            </span>
                          }
                          variant="calendar"
                        >
                          <HolidayManageContent branches={branches} holiday={holiday} year={year} />
                        </HolidayDialog>
                      ) : (
                        <span className={styles.calendarHolidayContent} key={holiday.id}>
                          <strong>{holiday.name}</strong>
                          <small>{holiday.source === "OFFICIAL" ? "Official holiday" : "Company holiday"}</small>
                        </span>
                      ))}
                      {canManage && dayHolidays.length === 0 ? (
                        <HolidayDialog
                          description="Add an official or company holiday for this date."
                          title={`New holiday · ${formatCalendarHeading(key)}`}
                          triggerLabel="＋ Add holiday"
                          variant="calendarAdd"
                        >
                          <HolidayForm branches={branches} initialDate={key} year={year} />
                        </HolidayDialog>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </HolidayCalendarView>
    </section>
  );
}

function HolidayManageContent({ branches, holiday, year }: { branches: BranchOption[]; holiday: HolidayRecord; year: number }) {
  return (
    <div className={styles.manageContent}>
      <HolidayForm branches={branches} holiday={holiday} year={year} />
      {holiday.source === "CUSTOM" ? (
        <form action={cancelHolidayAction} className={styles.cancelForm}>
          <input name="holidayId" type="hidden" value={holiday.id} />
          <input name="year" type="hidden" value={year} />
          <label><span>Cancellation reason</span><input maxLength={500} minLength={3} name="reason" required /></label>
          <button type="submit">Cancel company holiday</button>
        </form>
      ) : <p className={styles.officialNote}>Official holidays cannot be deleted. Use a correction to preserve the audit trail.</p>}
    </div>
  );
}

function HolidayForm({ branches, holiday, initialDate, year }: { branches: BranchOption[]; holiday?: HolidayRecord; initialDate?: string; year: number }) {
  const action = holiday ? reviseHolidayAction : createHolidayAction;
  return (
    <form action={action} className={styles.holidayForm}>
      {holiday ? <input name="holidayId" type="hidden" value={holiday.id} /> : null}
      <input name="year" type="hidden" value={year} />
      <label><span>Date</span><input defaultValue={holiday ? dateValue(holiday.workDate) : initialDate ?? `${year}-01-01`} name="workDate" required type="date" /></label>
      <label className={styles.wide}><span>Holiday name</span><input defaultValue={holiday?.name} maxLength={160} minLength={2} name="name" required /></label>
      <label><span>Holiday type</span><select defaultValue={holiday?.holidayType ?? "COMPANY_HOLIDAY"} name="holidayType"><option value="PUBLIC_HOLIDAY">Public holiday</option><option value="COMPANY_HOLIDAY">Company holiday</option><option value="SPECIAL_CLOSURE">Special closure</option></select></label>
      <HolidaySourceFields
        defaultOfficialReference={holiday?.officialReference}
        defaultSource={holiday?.source ?? "CUSTOM"}
      />
      <label><span>Holiday coverage</span><select defaultValue={holiday?.scope ?? "BUSINESS"} name="scope"><option value="NATIONAL">Malaysia nationwide</option><option value="STATE">One state / territory</option><option value="BUSINESS">Whole business</option><option value="BRANCH">One branch</option></select></label>
      <input name="countryCode" type="hidden" value="MY" />
      <label><span>State / territory</span><select defaultValue={holiday?.stateCode ?? ""} name="stateCode"><option value="">Not applicable</option>{malaysiaStateOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      {branches.length > 1 ? (
        <label><span>Branch</span><select defaultValue={holiday?.branchId ?? branches[0]?.id ?? ""} name="branchId">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      ) : (
        <input name="branchId" type="hidden" value={holiday?.branchId ?? branches[0]?.id ?? ""} />
      )}
      <label className={styles.check}><input defaultChecked={holiday?.statutory ?? false} name="statutory" type="checkbox" /><span>Statutory holiday evidence</span></label>
      <label className={styles.wide}><span>{holiday ? "Correction reason" : "Internal note"}</span><input maxLength={500} name="reason" placeholder={holiday ? "Explain why this version is changing" : "Optional"} required={Boolean(holiday)} /></label>
      <button className={styles.primary} type="submit">{holiday ? "Save correction" : "Add holiday"}</button>
    </form>
  );
}

function safeYear(value: string | undefined) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2200 ? parsed : new Date().getFullYear(); }
function dateValue(date: Date) { return date.toISOString().slice(0, 10); }
function formatDate(date: Date) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date); }
function formatCalendarHeading(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)); }
function stateLabel(stateCode: string | null) { return malaysiaStateOptions.find(([code]) => code === stateCode)?.[1] ?? "Jurisdiction not set"; }
function formatCatalogDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)); }

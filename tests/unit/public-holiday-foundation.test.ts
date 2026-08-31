import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  holidayAppliesToBranch,
  holidayContext,
  holidayInputSchema,
} from "../../src/lib/holidays/domain";
import { getOfficialHolidayCatalog, officialHolidayKey } from "../../src/lib/holidays/malaysia-official-calendar";

const sabahBranch = { id: "branch-sabah", countryCode: "MY", stateCode: "SBH" };
const klBranch = { id: "branch-kl", countryCode: "MY", stateCode: "KUL" };

test("Public Holiday applicability separates national, state, business and branch facts", () => {
  assert.equal(holidayAppliesToBranch({ scope: "NATIONAL", countryCode: "MY", stateCode: null, branchId: null }, sabahBranch), true);
  assert.equal(holidayAppliesToBranch({ scope: "STATE", countryCode: "MY", stateCode: "SBH", branchId: null }, sabahBranch), true);
  assert.equal(holidayAppliesToBranch({ scope: "STATE", countryCode: "MY", stateCode: "SBH", branchId: null }, klBranch), false);
  assert.equal(holidayAppliesToBranch({ scope: "BUSINESS", countryCode: "MY", stateCode: null, branchId: null }, klBranch), true);
  assert.equal(holidayAppliesToBranch({ scope: "BRANCH", countryCode: "MY", stateCode: null, branchId: "branch-sabah" }, sabahBranch), true);
  assert.equal(holidayAppliesToBranch({ scope: "BRANCH", countryCode: "MY", stateCode: null, branchId: "branch-sabah" }, klBranch), false);
  assert.equal(holidayAppliesToBranch({ scope: "NATIONAL", countryCode: "SG", stateCode: null, branchId: null }, sabahBranch), false);
});

test("Official and scoped holiday validation requires canonical evidence", () => {
  const base = {
    workDate: "2026-08-31",
    name: "National Day",
    holidayType: "PUBLIC_HOLIDAY" as const,
    source: "OFFICIAL" as const,
    scope: "NATIONAL" as const,
    countryCode: "MY",
    statutory: true,
  };
  assert.equal(holidayInputSchema.safeParse(base).success, false);
  assert.equal(holidayInputSchema.safeParse({ ...base, officialReference: "https://www.kabinet.gov.my/" }).success, true);
  assert.equal(holidayInputSchema.safeParse({ ...base, source: "CUSTOM", scope: "STATE", officialReference: null }).success, false);
  assert.equal(holidayInputSchema.safeParse({ ...base, source: "CUSTOM", scope: "BRANCH", officialReference: null }).success, false);
});

test("Holiday snapshot is traceable context and never a pay calculation", () => {
  const context = holidayContext({
    id: "holiday-1",
    workDate: new Date("2026-08-31T00:00:00.000Z"),
    name: "National Day",
    holidayType: "PUBLIC_HOLIDAY",
    source: "OFFICIAL",
    scope: "NATIONAL",
    revision: 2,
    statutory: true,
    officialReference: "https://www.kabinet.gov.my/",
    legacyPayrollHolidayId: null,
  });
  assert.deepEqual(context, {
    holidayOccurrenceId: "holiday-1",
    payrollHolidayId: null,
    name: "National Day",
    holidayType: "PUBLIC_HOLIDAY",
    source: "OFFICIAL",
    scope: "NATIONAL",
    revision: 2,
    statutory: true,
    officialReference: "https://www.kabinet.gov.my/",
  });
  assert.equal(Object.hasOwn(context!, "payAmount"), false);
  assert.equal(Object.hasOwn(context!, "payRate"), false);
});

test("Roster, Staff App and locked Timesheets consume the same holiday context", () => {
  const roster = readFileSync("src/lib/roster/service.ts", "utf8");
  const rosterPage = readFileSync("src/app/(business)/team/roster/page.tsx", "utf8");
  const staffPage = readFileSync("src/app/staff/roster/page.tsx", "utf8");
  const staffSchedule = readFileSync("src/components/staff-pwa/staff-schedule-v2.tsx", "utf8");
  const timesheet = readFileSync("src/lib/attendance/timesheet-service.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(roster, /resolveBranchHolidays/);
  assert.match(roster, /payrollEffect:\s*"NONE"/);
  assert.match(rosterPage, /MonthlyRosterView[\s\S]*holidays=/);
  assert.match(rosterPage, /DayRosterPanel[\s\S]*holidays=/);
  assert.match(`${staffPage}\n${staffSchedule}`, /Public Holiday/i);
  assert.match(timesheet, /holidayContextSnapshot/);
  assert.match(schema, /holidayContextSnapshot/);
});

test("Public Holiday page exposes a twelve-month calendar with direct edit dialogs", () => {
  const page = readFileSync("src/app/(business)/team/holidays/page.tsx", "utf8");
  const calendarView = readFileSync("src/app/(business)/team/holidays/holiday-calendar-view.tsx", "utf8");
  const dialog = readFileSync("src/app/(business)/team/holidays/holiday-dialog.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/team/holidays/holidays.module.css", "utf8");

  assert.match(page, /monthLabels\.map/);
  assert.match(page, /aria-label=\{`\$\{year\} holiday calendar`\}/);
  assert.doesNotMatch(page, /YEAR AT A GLANCE/);
  assert.match(page, /variant="calendar"/);
  assert.match(page, /variant="calendarAdd"/);
  assert.match(page, /officialPreview\?\.missingCount/);
  assert.match(page, /HolidayManageContent/);
  assert.match(page, /HolidayCalendarView year=\{year\}/);
  assert.match(calendarView, /12 months/);
  assert.match(calendarView, /One month/);
  assert.match(calendarView, /Previous month/);
  assert.match(calendarView, /Next month/);
  assert.match(calendarView, /aria-label="Holiday year"/);
  assert.match(calendarView, /View \$\{year - 1\}/);
  assert.doesNotMatch(page, /<h1>Public holidays<\/h1>/);
  assert.doesNotMatch(page, /Calendar only · No automatic pay changes/);
  assert.doesNotMatch(page, /styles\.hero/);
  assert.doesNotMatch(page, /holiday records/);
  assert.doesNotMatch(page, /styles\.holidayList/);
  assert.match(dialog, /triggerLabel: ReactNode/);
  assert.match(dialog, /dialogCalendarTrigger/);
  assert.match(styles, /\.calendarGrid/);
  assert.match(styles, /\.calendarHolidayDay/);
});

test("verified Sabah 2026 catalog is complete, deterministic and source-backed", () => {
  const catalog = getOfficialHolidayCatalog({ countryCode: "MY", stateCode: "SBH", year: 2026 });
  assert.ok(catalog);
  assert.equal(catalog.entries.length, 21);
  assert.equal(catalog.entries.every((entry) => entry.officialReference.startsWith("https://")), true);
  assert.equal(catalog.entries.some((entry) => entry.workDate === "2026-03-20" && entry.name.includes("Additional")), true);
  assert.equal(catalog.entries.some((entry) => entry.workDate === "2026-08-31" && entry.name === "National Day"), true);
  assert.equal(new Set(catalog.entries.map((entry) => officialHolidayKey(entry.workDate, entry.name))).size, 21);
  assert.equal(getOfficialHolidayCatalog({ countryCode: "MY", stateCode: "KUL", year: 2026 }), null);
});

test("official calendar import UI exposes preview, explicit import and server action", () => {
  const page = readFileSync("src/app/(business)/team/holidays/page.tsx", "utf8");
  const actions = readFileSync("src/app/(business)/team/holidays/actions.ts", "utf8");
  const service = readFileSync("src/lib/holidays/service.ts", "utf8");
  assert.match(page, /Review official dates before adding/);
  assert.match(page, /Add \{preview\.missingCount\} missing holidays/);
  assert.match(actions, /importOfficialHolidayCalendarAction/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /businessId: args\.businessId/);
});

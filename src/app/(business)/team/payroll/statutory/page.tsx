import Link from "next/link";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { loadStatutorySubmissionData } from "@/lib/payroll/statutory-data";
import {
  STATUTORY_EXPORT_VERSION,
  validateStatutorySubmission,
  type StatutorySubmissionProvider,
} from "@/lib/payroll/statutory-submission";
import { prisma } from "@/lib/prisma";
import {
  saveBusinessStatutoryProfileAction,
  markStatutoryFileExportedAction,
  saveEmployeeSubmissionProfileAction,
  updateStatutorySubmissionStatusAction,
} from "./actions";
import styles from "./statutory.module.css";

type PageProps = {
  searchParams: Promise<{ month?: string; message?: string; type?: string }>;
};

const providers: Array<{
  id: StatutorySubmissionProvider;
  name: string;
  portal: string;
  description: string;
}> = [
  { id: "EPF", name: "KWSP / EPF", portal: "e-Caruman CSV", description: "Official six-column contribution file for i-Akaun (Employer)." },
  { id: "PERKESO", name: "SOCSO + EIS", portal: "ASSIST Text v2.0", description: "278-character combined file based on PERKESO's 13 Feb 2026 specification." },
  { id: "PCB", name: "PCB / MTD", portal: "e-Data PCB TXT", description: "CP39 header and 136-character employee records for e-PCB Plus." },
];

export default async function StatutorySubmissionPage({ searchParams }: PageProps) {
  const context = await requireWholeBusinessPayroll("VIEW_STATUTORY_SUBMISSION");
  await requireWholeBusinessPayroll("VIEW_STATUTORY_PROFILE");
  await requireWholeBusinessPayroll("VIEW_TAX_PROFILE");
  const params = await searchParams;
  const month = params.month ?? new Date().toISOString().slice(0, 7);
  const notice = sanitizePayrollNotice(params.message, params.type);
  const [{ period, profile, run, submissions }, employees] = await Promise.all([
    loadStatutorySubmissionData(context.businessId, month),
    prisma.employeeBusinessMembership.findMany({
      where: { businessId: context.businessId, status: "ACTIVE" },
      orderBy: [{ fullName: "asc" }],
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        statutoryIdentityType: true,
        statutoryIdentityNumber: true,
        statutoryCountryCode: true,
        epfMemberNumber: true,
        socsoMemberNumber: true,
        taxIdentificationNumber: true,
      },
    }),
  ]);
  const canEditProfile = hasBusinessCapability(context.access, "EDIT_STATUTORY_PROFILE") && hasBusinessCapability(context.access, "EDIT_TAX_PROFILE");
  const canExport = hasBusinessCapability(context.access, "EXPORT_STATUTORY");
  const canSubmit = hasBusinessCapability(context.access, "SUBMIT_STATUTORY");
  const canResolve = hasBusinessCapability(context.access, "RESOLVE_STATUTORY_SUBMISSION");

  const validation = Object.fromEntries(providers.map((provider) => [
    provider.id,
    validateStatutorySubmission(provider.id, profile, run),
  ])) as Record<StatutorySubmissionProvider, ReturnType<typeof validateStatutorySubmission>>;
  const submissionByProvider = new Map(submissions.map((submission) => [submission.provider, submission]));
  const readyCount = providers.filter((provider) => validation[provider.id].ready).length;
  const configuredEmployees = employees.filter((employee) =>
    employee.statutoryIdentityType && employee.statutoryIdentityNumber,
  ).length;

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={`hr-module-header ${styles.header}`}>
        <div>
          <p className="hr-module-eyebrow">HR &amp; PAYROLL</p>
          <h1>Statutory submissions</h1>
          <p>Validate, export and track Malaysia statutory contribution submissions from finalized payroll.</p>
        </div>
        <nav className="hr-module-actions" aria-label="Statutory navigation">
          <Link href={`/team/payroll?month=${period.value}`}>Monthly payroll</Link>
          <Link href="/team?section=people">People</Link>
        </nav>
      </header>

      {notice ? <div className={`${styles.notice} ${params.type === "error" ? styles.error : styles.success}`} role={params.type === "error" ? "alert" : "status"}>{notice}</div> : null}

      <section className={styles.periodBar}>
        <div>
          <span className={styles.kicker}>SUBMISSION MONTH</span>
          <strong>{formatMonth(period.start)}</strong>
          <small>{run ? `${formatStatus(run.status)} payroll` : "Payroll not generated"}</small>
        </div>
        <form action="/team/payroll/statutory">
          <label><span>Month</span><input defaultValue={period.value} name="month" type="month" /></label>
          <button type="submit">View month</button>
        </form>
      </section>

      <section className={styles.metrics} aria-label="Statutory readiness summary">
        <Metric label="Providers ready" value={`${readyCount} / 3`} note="Official file validation" />
        <Metric label="Employee identities" value={`${configuredEmployees} / ${employees.length}`} note="Active employment profiles" />
        <Metric label="Payroll status" value={run ? formatStatus(run.status) : "Not generated"} note="Finalized is required" />
      </section>

      <section className={styles.providerGrid}>
        {providers.map((provider) => {
          const result = validation[provider.id];
          const submission = submissionByProvider.get(provider.id);
          return (
            <article className={styles.providerCard} key={provider.id}>
              <div className={styles.cardHeading}>
                <div><span className={styles.kicker}>{provider.portal}</span><h2>{provider.name}</h2></div>
                <span className={result.ready ? styles.ready : styles.blocked}>{result.ready ? "Ready" : "Needs setup"}</span>
              </div>
              <p>{provider.description}</p>
              <div className={styles.providerMeta}>
                <span><strong>{result.eligibleEntries.length}</strong> records</span>
                <span><strong>{submission ? formatStatus(submission.status) : "Not exported"}</strong> status</span>
              </div>
              {result.errors.length ? (
                <ul className={styles.issueList}>{result.errors.slice(0, 4).map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.employeeName ? `${issue.employeeName}: ` : ""}</strong>{issue.message}</li>)}</ul>
              ) : <div className={styles.passMessage}>All required fields passed pre-export validation.</div>}
              {result.errors.length > 4 ? <small className={styles.moreIssues}>+ {result.errors.length - 4} more issues below in employee profiles</small> : null}
              <div className={styles.cardActions}>
                {result.ready && canExport ? <Link className={styles.primaryButton} href={`/team/payroll/statutory/export?month=${period.value}&provider=${provider.id}`}>Download official file</Link> : <span className={styles.disabledButton}>{result.ready ? "No export access" : "Complete required fields"}</span>}
                {result.ready && canExport && run ? <form action={markStatutoryFileExportedAction}><input name="month" type="hidden" value={period.value} /><input name="payrollRunId" type="hidden" value={run.id} /><input name="provider" type="hidden" value={provider.id} /><button className={styles.secondaryButton} type="submit">Confirm downloaded file</button></form> : null}
                <small>{STATUTORY_EXPORT_VERSION[provider.id]}</small>
              </div>
              {submission ? <SubmissionWorkflow submission={submission} month={period.value} canSubmit={canSubmit} canResolve={canResolve} /> : null}
            </article>
          );
        })}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><span className={styles.kicker}>COMPANY REGISTRATION</span><h2>Employer statutory profile</h2><p>Store registration identifiers only. Portal passwords and secrets are never stored here.</p></div>
          <span className={styles.safeBadge}>Business scoped</span>
        </div>
        <form action={saveBusinessStatutoryProfileAction} className={styles.companyForm}>
          <input name="month" type="hidden" value={period.value} />
          <Field defaultValue={sensitiveDisplay(profile?.epfEmployerNumber, canEditProfile)} disabled={!canEditProfile} label="KWSP employer number" name="epfEmployerNumber" placeholder="Employer registration number" />
          <Field defaultValue={sensitiveDisplay(profile?.perkesoEmployerCode, canEditProfile)} disabled={!canEditProfile} label="PERKESO employer code" maxLength={12} name="perkesoEmployerCode" placeholder="Exactly 12 letters/digits" />
          <Field defaultValue={sensitiveDisplay(profile?.perkesoRegistrationNumber, canEditProfile)} disabled={!canEditProfile} label="MyCoID / SSM number" maxLength={20} name="perkesoRegistrationNumber" placeholder="Optional in ASSIST file" />
          <Field defaultValue={sensitiveDisplay(profile?.lhdnEmployerNumberHq, canEditProfile)} disabled={!canEditProfile} inputMode="numeric" label="LHDN employer no. (HQ)" maxLength={10} name="lhdnEmployerNumberHq" placeholder="10 digits" />
          <Field defaultValue={sensitiveDisplay(profile?.lhdnEmployerNumber, canEditProfile)} disabled={!canEditProfile} inputMode="numeric" label="LHDN employer number" maxLength={10} name="lhdnEmployerNumber" placeholder="10 digits" />
          {canEditProfile ? <button className={styles.primaryButton} type="submit">Save company registration</button> : null}
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><span className={styles.kicker}>EMPLOYEE IDENTITIES</span><h2>Submission profiles</h2><p>These identifiers are business-scoped and used only for statutory validation and exports.</p></div>
          <span className={styles.safeBadge}>{employees.length} employees</span>
        </div>
        <div className={styles.employeeList}>
          {employees.map((employee) => {
            const complete = Boolean(employee.statutoryIdentityType && employee.statutoryIdentityNumber);
            return (
              <details className={styles.employeeCard} key={employee.id}>
                <summary><span className={styles.avatar}>{initials(employee.fullName)}</span><span><strong>{employee.fullName}</strong><small>{employee.employeeCode}</small></span><span className={complete ? styles.profileComplete : styles.profileIncomplete}>{complete ? "Identity added" : "Missing identity"}</span></summary>
                <form action={saveEmployeeSubmissionProfileAction} className={styles.employeeForm}>
                  <input name="membershipId" type="hidden" value={employee.id} />
                  <input name="month" type="hidden" value={period.value} />
                  <label><span>Identity type</span><select defaultValue={employee.statutoryIdentityType ?? ""} disabled={!canEditProfile} name="statutoryIdentityType"><option value="">Select type</option><option value="NEW_IC">New IC / MyKad</option><option value="OLD_IC">Old IC</option><option value="PASSPORT">Passport</option><option value="OTHER">Other</option></select></label>
                  <Field defaultValue={sensitiveDisplay(employee.statutoryIdentityNumber, canEditProfile)} disabled={!canEditProfile} label="Identity number" name="statutoryIdentityNumber" placeholder="No spaces or dashes preferred" />
                  <Field defaultValue={employee.statutoryCountryCode ?? ""} disabled={!canEditProfile} label="LHDN country code" maxLength={2} name="statutoryCountryCode" placeholder="Passport only, e.g. MY" />
                  <Field defaultValue={sensitiveDisplay(employee.epfMemberNumber, canEditProfile)} disabled={!canEditProfile} label="KWSP member number" name="epfMemberNumber" placeholder="EPF member number" />
                  <Field defaultValue={sensitiveDisplay(employee.socsoMemberNumber, canEditProfile)} disabled={!canEditProfile} label="SOCSO / foreign worker no." name="socsoMemberNumber" placeholder="Optional if IC is used" />
                  <Field defaultValue={sensitiveDisplay(employee.taxIdentificationNumber, canEditProfile)} disabled={!canEditProfile} inputMode="numeric" label="Tax Identification Number" maxLength={11} name="taxIdentificationNumber" placeholder="11 digits" />
                  {canEditProfile ? <button className={styles.secondaryButton} type="submit">Save employee profile</button> : null}
                </form>
              </details>
            );
          })}
          {!employees.length ? <div className={styles.empty}>No active employment profiles are available.</div> : null}
        </div>
      </section>

      <section className={styles.referenceNote}>
        <strong>Official format references</strong>
        <p>Exports follow KWSP e-Caruman CSV guidance, PERKESO Combined SOCSO + EIS Text File Format v2.0 dated 13 February 2026, and LHDN CP39 text layout. Always validate the file in the official portal before payment.</p>
      </section>
    </main>
  );
}

function SubmissionWorkflow({ submission, month, canSubmit, canResolve }: { submission: { id: string; status: string; exportedAt: Date; submittedAt: Date | null; resolvedAt: Date | null; submissionReference: string | null; rejectionReason: string | null }; month: string; canSubmit: boolean; canResolve: boolean }) {
  return (
    <div className={styles.workflow}>
      <div><strong>{formatStatus(submission.status)}</strong><small>Exported {formatDate(submission.exportedAt)}{submission.submissionReference ? ` · Ref ${submission.submissionReference}` : ""}</small></div>
      {submission.rejectionReason ? <p className={styles.rejection}>Rejected: {submission.rejectionReason}</p> : null}
      {canSubmit && submission.status === "EXPORTED" ? (
        <form action={updateStatutorySubmissionStatusAction} className={styles.statusForm}>
          <input name="month" type="hidden" value={month} /><input name="submissionId" type="hidden" value={submission.id} /><input name="targetStatus" type="hidden" value="SUBMITTED" />
          <input maxLength={100} name="submissionReference" placeholder="Portal reference" required /><button type="submit">Mark submitted</button>
        </form>
      ) : null}
      {canResolve && submission.status === "SUBMITTED" ? (
        <div className={styles.resolveForms}>
          <form action={updateStatutorySubmissionStatusAction}><input name="month" type="hidden" value={month} /><input name="submissionId" type="hidden" value={submission.id} /><input name="targetStatus" type="hidden" value="ACCEPTED" /><button type="submit">Mark accepted</button></form>
          <form action={updateStatutorySubmissionStatusAction}><input name="month" type="hidden" value={month} /><input name="submissionId" type="hidden" value={submission.id} /><input name="targetStatus" type="hidden" value="REJECTED" /><input minLength={5} name="notes" placeholder="Rejection reason" required /><button className={styles.rejectButton} type="submit">Mark rejected</button></form>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label><span>{label}</span><input {...props} /></label>; }
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function formatMonth(date: Date) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(date); }
function formatDate(date: Date) { return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" }).format(date); }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function sensitiveDisplay(value: string | null | undefined, reveal: boolean) { return !value ? "" : reveal ? value : `••••${value.slice(-4)}`; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }

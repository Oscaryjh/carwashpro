import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeAuthProfile } from "@/lib/attendance/employee-auth/session";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import { getEmployeeClaimOverview } from "@/lib/claim/service";
import { getEmployeeCommissionStatements } from "@/lib/commission/read";
import { getEmployeeLeaveOverview } from "@/lib/leave/service";
import type { ModuleKey } from "@/lib/modules/registry";
import { loadPublishedPayslipsForEmployee } from "@/lib/payroll/payslip-publication";
import { addDays, dateOnly } from "@/lib/roster/domain";
import { getEmployeePublishedRoster } from "@/lib/roster/service";

export type StaffHomeCard = {
  domain: "ROSTER" | "TIMESHEET" | "LEAVE" | "CLAIMS" | "COMMISSION" | "PAYSLIP";
  label: string;
  value: string;
  detail: string;
  href: string;
  status: "READY" | "UNAVAILABLE";
};

export async function getStaffHomeOverview(
  auth: EmployeeAuthContext,
  enabledModules: readonly string[],
) {
  const modules = new Set(enabledModules as readonly ModuleKey[]);
  const profile = await getEmployeeAuthProfile(auth);
  const loaders: Array<Promise<StaffHomeCard>> = [];

  if (modules.has("HR")) {
    loaders.push(
      safeCard("ROSTER", "My Schedule", "/staff/roster", async () => {
        const today = dateOnly(new Date());
        const schedule = await getEmployeePublishedRoster({
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          branchId: auth.attendanceBranchId ?? auth.primaryBranchId,
          from: today,
          to: addDays(today, 7),
        });
        const next = schedule[0];
        return next
          ? {
              value: next.kind === "WORK_SHIFT" ? "Scheduled shift" : humanize(next.kind),
              detail: `${date(next.workDate)} · ${next.branch.name}.`,
            }
          : {
              value: "No effective schedule",
              detail: "Tetamu will not infer that an unspecified day is an Off Day.",
            };
      }),
      safeCard("TIMESHEET", "My Timesheets", "/staff/timesheet", async () => {
        const overview = await getEmployeeTimesheetOverview(auth);
        return {
          value: overview.exceptions.length
            ? `${overview.exceptions.length} unresolved`
            : `${overview.latest.length} day result${overview.latest.length === 1 ? "" : "s"}`,
          detail: overview.exceptions.length
            ? "Attendance issues need correction or manager review."
            : "Current-month final attendance outcomes.",
        };
      }),
      safeCard("LEAVE", "My Leave", "/staff/leave", async () => {
        const overview = await getEmployeeLeaveOverview(auth);
        const pending = overview.requests.filter((request) => request.status === "PENDING").length;
        return {
          value: pending ? `${pending} pending` : "No pending request",
          detail: overview.requests[0]
            ? `Latest application: ${humanize(overview.requests[0].status)}.`
            : "Leave applications and balances appear here.",
        };
      }),
    );
  }
  if (modules.has("CLAIMS")) {
    loaders.push(
      safeCard("CLAIMS", "My Claims", "/staff/claims", async () => {
        const overview = await getEmployeeClaimOverview(auth);
        const pending = overview.claims.filter((claim) => claim.status === "SUBMITTED").length;
        return {
          value: pending ? `${pending} pending` : "No pending claim",
          detail: overview.claims[0]
            ? `Latest claim: ${humanize(overview.claims[0].status)}.`
            : "Submit and track reimbursements here.",
        };
      }),
    );
  }
  if (modules.has("COMMISSION")) {
    loaders.push(
      safeCard("COMMISSION", "My Commission", "/staff/commission", async () => {
        const statements = await getEmployeeCommissionStatements({
          businessId: auth.businessId,
          membershipId: auth.membershipId,
        });
        const latest = statements[0];
        return latest
          ? {
              value: `RM ${(latest.finalCommissionCents / 100).toFixed(2)}`,
              detail: `Latest statement: ${commissionStatusLabel(latest.status)}.`,
            }
          : { value: "No commission yet", detail: "Calculated and approved statements appear here." };
      }),
    );
  }
  if (modules.has("PAYROLL")) {
    loaders.push(
      safeCard("PAYSLIP", "My Payslips", "/staff/payslips", async () => {
        const payslips = await loadPublishedPayslipsForEmployee({
          businessId: auth.businessId,
          membershipId: auth.membershipId,
        });
        const latest = payslips[0];
        return latest
          ? {
              value: month(latest.payrollRun.periodStart),
              detail: `Published ${date(latest.publishedAt)}.`,
            }
          : { value: "No published payslip", detail: "Only documents published to your account appear here." };
      }),
    );
  }

  return {
    profile,
    cards: await Promise.all(loaders),
    showWelcome: true,
  };
}

async function safeCard(
  domain: StaffHomeCard["domain"],
  label: string,
  href: string,
  loader: () => Promise<{ value: string; detail: string }>,
): Promise<StaffHomeCard> {
  try {
    return { domain, label, href, status: "READY", ...(await loader()) };
  } catch {
    return {
      domain,
      label,
      href,
      status: "UNAVAILABLE",
      value: "Temporarily unavailable",
      detail: "Open the section to retry. No unavailable data was treated as empty.",
    };
  }
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function commissionStatusLabel(status: string) {
  if (status === "CALCULATED") return "estimated, pending review";
  if (status === "APPROVED") return "approved and frozen";
  if (status === "APPLIED_TO_PAYROLL") return "approved and sent to Payroll";
  return humanize(status);
}

function month(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}

import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import {
  getStaffOvertimeSummary,
  resolveStaffOvertimeAccess,
} from "@/lib/staff-pwa/overtime-approvals";
import {
  getStaffTeamApprovalSummary,
  resolveStaffTeamApprovalAccess,
} from "@/lib/staff-pwa/team-approvals";

type CapabilityState = "capable" | "not-capable" | "unknown";

type RequestsHubDependencies = Readonly<{
  getTeamSummary: typeof getStaffTeamApprovalSummary;
  getOvertimeSummary: typeof getStaffOvertimeSummary;
  resolveTeamAccess: typeof resolveStaffTeamApprovalAccess;
  resolveOvertimeAccess: typeof resolveStaffOvertimeAccess;
}>;

export type RequestsApprovalEntry = Readonly<{
  meta: string;
}>;

const defaultDependencies: RequestsHubDependencies = {
  getTeamSummary: getStaffTeamApprovalSummary,
  getOvertimeSummary: getStaffOvertimeSummary,
  resolveTeamAccess: resolveStaffTeamApprovalAccess,
  resolveOvertimeAccess: resolveStaffOvertimeAccess,
};

export async function loadRequestsApprovalEntry(
  auth: EmployeeAuthContext,
  dependencies: Partial<RequestsHubDependencies> = {},
): Promise<RequestsApprovalEntry | null> {
  const services = { ...defaultDependencies, ...dependencies };
  const [teamSummary, overtimeSummary] = await Promise.allSettled([
    services.getTeamSummary(auth),
    services.getOvertimeSummary(auth),
  ]);
  const [teamCapability, overtimeCapability] = await Promise.all([
    capabilityAfterSummaryFailure(
      teamSummary,
      () => services.resolveTeamAccess(auth),
    ),
    capabilityAfterSummaryFailure(
      overtimeSummary,
      () => services.resolveOvertimeAccess(auth),
    ),
  ]);
  const hasKnownCapability = teamCapability === "capable" || overtimeCapability === "capable";
  if (!hasKnownCapability) return null;

  const summaryUnavailable =
    (teamSummary.status === "rejected" && teamCapability !== "not-capable") ||
    (overtimeSummary.status === "rejected" && overtimeCapability !== "not-capable");
  if (summaryUnavailable) return { meta: "Unavailable" };

  const pending =
    (teamSummary.status === "fulfilled" ? teamSummary.value?.total ?? 0 : 0) +
    (overtimeSummary.status === "fulfilled" ? overtimeSummary.value?.pending ?? 0 : 0);
  return {
    meta: pending > 0
      ? `${pending} waiting for you`
      : "All clear",
  };
}

async function capabilityAfterSummaryFailure<T>(
  summary: PromiseSettledResult<T | null>,
  resolveAccess: () => Promise<unknown | null>,
): Promise<CapabilityState> {
  if (summary.status === "fulfilled") {
    return summary.value ? "capable" : "not-capable";
  }
  try {
    return (await resolveAccess()) ? "capable" : "not-capable";
  } catch {
    return "unknown";
  }
}

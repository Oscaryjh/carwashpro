import { createHash } from "node:crypto";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";

export const staffPerformanceEnabled = () => process.env.TETAMU_STAFF_PERFORMANCE === "true";
/** Opaque binding only, not an authorization token. No session ID/token is sent to the browser. */
export const staffPerformanceScopeKey = (auth: EmployeeAuthContext) => createHash("sha256")
  .update([auth.sessionId, auth.businessId, auth.membershipId, auth.attendanceBranchId ?? auth.primaryBranchId].join(":"))
  .digest("hex");

export class StaffPerformanceAccessError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

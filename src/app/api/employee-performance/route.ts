import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { EmployeeAuthError } from "@/lib/attendance/employee-auth/errors";
import { assertEmployeeAuthSameOrigin } from "@/lib/attendance/employee-auth/http";
import { readStaffPerformance } from "@/lib/staff-pwa/performance";
import { staffPerformanceEnabled, StaffPerformanceAccessError } from "@/lib/staff-pwa/performance-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  try {
    if (!staffPerformanceEnabled()) throw new StaffPerformanceAccessError(404, "PERFORMANCE_DISABLED");
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => params.getAll(k).length !== 1)) throw new StaffPerformanceAccessError(400, "INVALID_REQUEST");
    const result = await readStaffPerformance(auth, Object.fromEntries(params));
    return NextResponse.json(result, { headers });
  } catch (error) {
    const known = error instanceof StaffPerformanceAccessError || error instanceof EmployeeAuthError;
    const status = known ? error.status : error instanceof ZodError ? 400 : 503;
    if (status === 503) console.error("Staff performance read failed", error);
    return NextResponse.json({ ok: false, error: { code: known ? error.code : "PERFORMANCE_UNAVAILABLE",
      message: status === 403 ? "Performance access is not available for this scope." : status === 401 ? "Please sign in again." : status === 404 ? "Performance is not enabled." : "Performance could not be updated. Please retry." } }, { status, headers });
  }
}

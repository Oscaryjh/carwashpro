import { assertEmployeeAuthSameOrigin } from "@/lib/attendance/employee-auth/http";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import { getEmployeeClaimOverview, submitEmployeeClaim, withdrawEmployeeClaim } from "@/lib/claim/service";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "CLAIMS");
    return employeeAttendanceJson({ ok: true, data: await getEmployeeClaimOverview(auth) });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "CLAIMS");
    const form = await request.formData();
    const payload = JSON.parse(String(form.get("payload") ?? "null"));
    const uploadedFiles = [];
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("receipt:") || !(value instanceof File) || value.size === 0) continue;
      const lineNumber = Number(key.slice("receipt:".length));
      if (!Number.isInteger(lineNumber)) throw new Error("Receipt line number is invalid.");
      uploadedFiles.push({
        lineNumber,
        bytes: new Uint8Array(await value.arrayBuffer()),
        claimedMimeType: value.type,
        originalFileName: value.name,
      });
    }
    const result = await submitEmployeeClaim(auth, payload, uploadedFiles);
    return employeeAttendanceJson({ ok: true, data: result }, { status: 201 });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "CLAIMS");
    const input = await request.json();
    return employeeAttendanceJson({ ok: true, data: await withdrawEmployeeClaim(auth, input) });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

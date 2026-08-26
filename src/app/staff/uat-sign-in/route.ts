import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { EMPLOYEE_SESSION_COOKIE } from "@/lib/attendance/employee-auth/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function GET(request: NextRequest) {
  if (
    process.env.NODE_ENV === "production" ||
    !LOCAL_HOSTS.has(request.nextUrl.hostname.toLowerCase())
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const isFresh = request.nextUrl.searchParams.get("flow") === "fresh";
  const artifact = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        ".tmp",
        isFresh
          ? "hr-payroll-fresh-e2e.json"
          : "hr-payroll-five-role-uat.json",
      ),
      "utf8",
    ),
  ) as {
    employee?: { accountId?: string; sessionToken?: string };
    manager?: { sessionToken?: string };
  };
  const persona = request.nextUrl.searchParams.get("persona") ?? "employee";
  const token = (persona === "manager"
    ? artifact.manager?.sessionToken
    : artifact.employee?.sessionToken
  )?.trim();
  if (!token) {
    return new NextResponse("Local employee UAT session is not prepared.", {
      status: 409,
    });
  }

  const requestedTarget = request.nextUrl.searchParams.get("target") ?? "/staff";
  const target =
    requestedTarget === "/staff" || requestedTarget.startsWith("/staff/")
      ? requestedTarget
      : "/staff";
  const freshEmployeeDeviceIdentifier =
    isFresh && persona !== "manager" && artifact.employee?.accountId
      ? `fresh-${artifact.employee.accountId}`
      : null;
  const response = freshEmployeeDeviceIdentifier
    ? new NextResponse(
        `<!doctype html><html><head><meta charset="utf-8"><title>Preparing local UAT session</title></head><body><script>localStorage.setItem("tetamu.staff.device", ${JSON.stringify(
          freshEmployeeDeviceIdentifier,
        )});location.replace(${JSON.stringify(target)});</script></body></html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      )
    : NextResponse.redirect(new URL(target, request.url));
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return response;
}

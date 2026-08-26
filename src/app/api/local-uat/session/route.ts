import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { EMPLOYEE_SESSION_COOKIE } from "@/lib/attendance/employee-auth/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export async function GET(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (process.env.NODE_ENV === "production" || !LOCAL_HOSTS.has(hostname)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const token = await resolveLocalToken(request);
  const requestedTarget = request.nextUrl.searchParams.get("target") ?? "/team";
  const surface = request.nextUrl.searchParams.get("surface") ?? "app";
  if (!token || token.split(".").length !== 3) {
    return new NextResponse("A local UAT session token is required.", {
      status: 400,
    });
  }

  const target = allowedTarget(requestedTarget, surface);
  const response = NextResponse.redirect(new URL(target, request.url));
  if (surface === "employee") {
    response.cookies.set(EMPLOYEE_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
  } else {
    response.cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(undefined, {
        ...process.env,
        NODE_ENV: "development",
      }),
    );
  }
  return response;
}

async function resolveLocalToken(request: NextRequest) {
  const explicitToken = request.nextUrl.searchParams.get("token")?.trim();
  if (explicitToken) return explicitToken;
  const persona = request.nextUrl.searchParams.get("persona")?.trim();
  if (!persona) return null;
  if (request.nextUrl.searchParams.get("flow") === "fresh") {
    const fresh = JSON.parse(
      await readFile(
        join(process.cwd(), ".tmp", "hr-payroll-fresh-e2e.json"),
        "utf8",
      ),
    ) as {
      owner?: { sessionToken?: string };
      hr?: { sessionToken?: string };
    };
    return persona === "BUSINESS_OWNER"
      ? fresh.owner?.sessionToken
      : persona === "HR"
        ? fresh.hr?.sessionToken
        : null;
  }
  const artifact = JSON.parse(
    await readFile(
      join(process.cwd(), ".tmp", "hr-payroll-five-role-uat.json"),
      "utf8",
    ),
  ) as {
    users: Array<{ persona: string; appSessionToken: string }>;
    owner?: { persona: string; appSessionToken: string };
  };
  return [...artifact.users, ...(artifact.owner ? [artifact.owner] : [])].find(
    (entry) => entry.persona === persona,
  )?.appSessionToken;
}

function allowedTarget(requestedTarget: string, surface: string) {
  if (surface === "employee") {
    const employeePath =
      requestedTarget === "/staff" || requestedTarget.startsWith("/staff/")
        ? requestedTarget
        : "/staff";
    return new URL(employeePath, "http://localhost:3100").toString();
  }
  return requestedTarget === "/team" || requestedTarget.startsWith("/team/")
    ? requestedTarget
    : "/team";
}

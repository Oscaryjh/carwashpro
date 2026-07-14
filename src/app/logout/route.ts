import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { tryWriteAuditLog } from "@/lib/audit";
import { destroySession, getSession } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  await auditLogout(request);
  await destroySession();
  redirect("/login");
}

export async function GET(request: NextRequest) {
  await auditLogout(request);
  await destroySession();

  const error = request.nextUrl.searchParams.get("error");
  const target = error ? `/login?error=${encodeURIComponent(error)}` : "/login";

  redirect(target);
}

async function auditLogout(request: NextRequest) {
  const session = await getSession();

  if (!session?.businessId) {
    return;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");

  await tryWriteAuditLog({
    businessId: session.businessId,
    branchId: session.branchId,
    actor: session,
    action: "USER_LOGOUT",
    entityType: "User",
    entityId: session.userId,
    summary: `${session.name} logged out`,
    request: {
      ipAddress:
        forwardedFor?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        null,
      userAgent: request.headers.get("user-agent"),
    },
  });
}

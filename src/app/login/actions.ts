"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import {
  createSession,
  SESSION_CONTEXT_VERSION,
} from "@/lib/auth/session";
import type { AppSession, CreateSessionInput } from "@/lib/auth/session";
import { getLoginDestination } from "@/lib/auth/login-destination";
import { authenticatePasswordLogin } from "@/lib/auth/password-login";
import { getAuthRequestContext } from "@/lib/auth/security";
import {
  commitBusinessContextSwitch,
  getRecoveryBusinessContext,
} from "@/lib/business-groups/business-context";
import { loginSchema } from "@/lib/validation/login";

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }

  const requestContext = getAuthRequestContext(await headers());
  let authenticated: Awaited<ReturnType<typeof authenticatePasswordLogin>>;
  try {
    authenticated = await authenticatePasswordLogin({
      email: parsed.data.email,
      password: parsed.data.password,
      request: requestContext,
    });
  } catch (error) {
    console.error("[auth] Password login security check failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { error: "Unable to sign in safely. Please try again later." };
  }

  if (!authenticated.ok) {
    return {
      error:
        authenticated.code === "RATE_LIMITED"
          ? "Too many attempts. Try again later."
          : "Invalid login details.",
    };
  }

  const user = authenticated.user;

  if (user.businessId) {
    await writeAuditLog({
      businessId: user.businessId,
      branchId: user.branchId,
      actor: {
        userId: user.id,
        name: user.name,
        email: user.email,
      },
      action: "USER_LOGIN",
      entityType: "User",
      entityId: user.id,
      summary: `${user.name} logged in`,
      metadata: { role: user.role },
      request: await getAuditRequestContext(),
    });
  }

  const session: CreateSessionInput = {
    userId: user.id,
    sessionId: randomUUID(),
    homeBusinessId: user.businessId,
    activeBusinessId: user.businessId,
    contextVersion: SESSION_CONTEXT_VERSION,
    industryType: user.business?.industryType ?? null,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  };

  const loginDestination = getLoginDestination({
    role: user.role,
    businessId: user.businessId,
    industryType: user.business?.industryType ?? null,
  });

  if (loginDestination === "/business-context/recover") {
    const recoverySession = {
      ...session,
      businessId: null,
    } satisfies AppSession;
    const recovery = await getRecoveryBusinessContext(recoverySession);

    if (!recovery.ok) {
      await createSession(session, { request: requestContext });
      redirect("/no-business-access");
    }

    const result = await commitBusinessContextSwitch({
      session: recoverySession,
      targetBusinessId: recovery.context.businessId,
      source: "RECOVERY",
    });

    if (!result.ok) {
      await createSession(session, { request: requestContext });
      redirect("/no-business-access");
    }

    redirect(result.destination);
  }

  await createSession(session, { request: requestContext });

  redirect(loginDestination);
}

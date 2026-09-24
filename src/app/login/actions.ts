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
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import {
  messageForLoginException,
  messageForPasswordLoginFailure,
} from "./login-feedback";

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

  let requestContext: ReturnType<typeof getAuthRequestContext>;
  let authenticated: Awaited<ReturnType<typeof authenticatePasswordLogin>>;
  try {
    requestContext = getAuthRequestContext(await headers());
    authenticated = await authenticatePasswordLogin({
      email: parsed.data.email,
      password: parsed.data.password,
      request: requestContext,
    });
  } catch (error) {
    console.error("[auth] Password login security check failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { error: messageForLoginException(error) };
  }

  if (!authenticated.ok) {
    return { error: messageForPasswordLoginFailure(authenticated.code) };
  }

  const user = authenticated.user;
  let loginDestination: string;
  try {
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

    loginDestination = getLoginDestination({
      role: user.role,
      businessId: user.businessId,
      industryType: user.business?.industryType ?? null,
    });
    if (user.businessId && user.role !== "PLATFORM_ADMIN") {
      const moduleContext = await loadBusinessModuleContext(user.businessId);
      const operationalHomeEnabled =
        loginDestination === "/work-orders"
          ? moduleContext.enabledModules.has("POS") &&
            moduleContext.enabledModules.has("AUTO")
          : loginDestination === "/cashier"
            ? moduleContext.enabledModules.has("POS")
            : true;
      if (!operationalHomeEnabled) loginDestination = "/team";
    }

    if (loginDestination === "/business-context/recover") {
      const recoverySession = {
        ...session,
        businessId: null,
      } satisfies AppSession;
      const recovery = await getRecoveryBusinessContext(recoverySession);

      if (!recovery.ok) {
        await createSession(session, { request: requestContext });
        loginDestination = "/no-business-access";
      } else {
        const result = await commitBusinessContextSwitch({
          session: recoverySession,
          targetBusinessId: recovery.context.businessId,
          source: "RECOVERY",
        });
        if (!result.ok) {
          await createSession(session, { request: requestContext });
          loginDestination = "/no-business-access";
        } else {
          loginDestination = result.destination;
        }
      }
    } else {
      await createSession(session, { request: requestContext });
    }
  } catch (error) {
    console.error("[auth] Password login completion failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined,
    });
    return { error: messageForLoginException(error) };
  }
  redirect(loginDestination);
}

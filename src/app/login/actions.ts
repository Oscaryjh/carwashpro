"use server";

import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import {
  createSession,
  SESSION_CONTEXT_VERSION,
} from "@/lib/auth/session";
import type { AppSession, CreateSessionInput } from "@/lib/auth/session";
import { getLoginDestination } from "@/lib/auth/login-destination";
import {
  commitBusinessContextSwitch,
  getRecoveryBusinessContext,
} from "@/lib/business-groups/business-context";
import { prisma } from "@/lib/prisma";
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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { business: true },
  });

  if (
    !user ||
    user.status !== "active" ||
    !user.loginEnabled ||
    !user.email ||
    !user.passwordHash
  ) {
    return { error: "Invalid login details." };
  }

  if (user.business && user.business.status !== "active") {
    return { error: "This business is inactive." };
  }

  const isPasswordValid = await bcrypt.compare(
    parsed.data.password,
    user.passwordHash,
  );

  if (!isPasswordValid) {
    return { error: "Invalid login details." };
  }

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
      await createSession(session);
      redirect("/no-business-access");
    }

    const result = await commitBusinessContextSwitch(
      {
        session: recoverySession,
        targetBusinessId: recovery.context.businessId,
        source: "RECOVERY",
      },
      { writeSession: createSession },
    );

    if (!result.ok) {
      await createSession(session);
      redirect("/no-business-access");
    }

    redirect(result.destination);
  }

  await createSession(session);

  redirect(loginDestination);
}

"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
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
    rememberMe: formData.get("rememberMe"),
  });

  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { business: true },
  });

  if (!user || user.status !== "active") {
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

  await createSession({
    userId: user.id,
    businessId: user.businessId,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  }, {
    rememberMe: parsed.data.rememberMe,
  });

  if (user.role === "PLATFORM_ADMIN") {
    redirect("/admin/businesses");
  }

  redirect("/dashboard");
}

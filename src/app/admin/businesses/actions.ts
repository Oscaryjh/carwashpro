"use server";

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import path from "path";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { assertCanManageBusiness, assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  adminResetUserPasswordSchema,
  adminUpdateUserEmailSchema,
  businessSchema,
  createBusinessSchema,
} from "@/lib/validation/business";
import { branchSchema } from "@/lib/validation/branches";

const LOGO_UPLOAD_DIR = path.join(
  process.cwd(),
  "public",
  "uploads",
  "business-logos",
);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export async function createBusinessAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const auditRequest = await getAuditRequestContext();

  const input = createBusinessSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    companyNo: formData.get("companyNo"),
    phone: formData.get("phone"),
    ownerName: formData.get("ownerName"),
    ownerEmail: formData.get("ownerEmail"),
    ownerPassword: formData.get("ownerPassword"),
  });
  const ownerEmail = input.ownerEmail.toLowerCase();

  const [existingBusiness, existingUser] = await Promise.all([
    prisma.business.findUnique({ where: { slug: input.slug } }),
    prisma.user.findUnique({ where: { email: ownerEmail } }),
  ]);

  if (existingBusiness) {
    throw new Error("Business slug already exists.");
  }

  if (existingUser) {
    throw new Error("Login email already exists.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const newBusiness = await tx.business.create({
      data: {
        name: input.name,
        slug: input.slug,
        companyNo: input.companyNo || null,
        phone: input.phone || null,
        status: "active",
      },
    });

    const mainBranch = await tx.branch.create({
      data: {
        businessId: newBusiness.id,
        name: newBusiness.name,
        phone: newBusiness.phone,
        status: "ACTIVE",
      },
    });

    const passwordHash = await bcrypt.hash(input.ownerPassword, 12);

    const owner = await tx.user.create({
      data: {
        businessId: newBusiness.id,
        branchId: mainBranch.id,
        name: input.ownerName,
        email: ownerEmail,
        passwordHash,
        role: "BUSINESS_OWNER",
        status: "active",
      },
    });

    await writeAuditLog(
      {
        businessId: newBusiness.id,
        actor: user,
        action: "BUSINESS_CREATED",
        entityType: "Business",
        entityId: newBusiness.id,
        summary: `Created business ${newBusiness.name}`,
        after: {
          name: newBusiness.name,
          slug: newBusiness.slug,
          companyNo: newBusiness.companyNo,
          phone: newBusiness.phone,
          status: newBusiness.status,
          ownerId: owner.id,
          ownerEmail: owner.email,
          mainBranchId: mainBranch.id,
          mainBranchName: mainBranch.name,
        },
        request: auditRequest,
      },
      tx,
    );

    await writeAuditLog(
      {
        businessId: newBusiness.id,
        branchId: mainBranch.id,
        actor: user,
        action: "BRANCH_CREATED",
        entityType: "Branch",
        entityId: mainBranch.id,
        summary: `Provisioned main branch ${mainBranch.name}`,
        after: mainBranch,
        metadata: { provisionedWithBusiness: true },
        request: auditRequest,
      },
      tx,
    );

    return newBusiness;
  });

  revalidatePath("/admin/businesses");
  redirect(`/admin/businesses/${created.id}`);
}

export async function createAdminBusinessBranchAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const auditRequest = await getAuditRequestContext();
  const businessId = formData.get("businessId")?.toString();

  if (!businessId) {
    throw new Error("Business id is required.");
  }

  const input = branchSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    status: "ACTIVE",
  });

  const [business, duplicate] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }),
    prisma.branch.findFirst({
      where: { businessId, name: input.name },
      select: { id: true },
    }),
  ]);

  if (!business) {
    throw new Error("Business not found.");
  }

  if (duplicate) {
    throw new Error("Branch name already exists in this business.");
  }

  await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({
      data: {
        businessId,
        name: input.name,
        phone: input.phone || null,
        address: input.address || null,
        status: "ACTIVE",
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: branch.id,
        actor: user,
        action: "BRANCH_CREATED",
        entityType: "Branch",
        entityId: branch.id,
        summary: `Provisioned branch ${branch.name}`,
        after: branch,
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath("/branches");
  redirect(`/admin/businesses/${businessId}`);
}

export async function updateAdminBusinessBranchStatusAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const auditRequest = await getAuditRequestContext();
  const businessId = formData.get("businessId")?.toString();
  const branchId = formData.get("branchId")?.toString();
  const status = formData.get("status")?.toString();

  if (!businessId || !branchId) {
    throw new Error("Business and branch ids are required.");
  }

  if (status !== "ACTIVE" && status !== "INACTIVE") {
    throw new Error("Invalid branch status.");
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId },
  });

  if (!branch) {
    throw new Error("Branch not found for this business.");
  }

  if (branch.status === status) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.branch.update({
      where: { id: branch.id },
      data: { status },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: branch.id,
        actor: user,
        action: status === "ACTIVE" ? "BRANCH_ACTIVATED" : "BRANCH_DEACTIVATED",
        entityType: "Branch",
        entityId: branch.id,
        summary: `${status === "ACTIVE" ? "Activated" : "Deactivated"} branch ${branch.name}`,
        before: { status: branch.status },
        after: { status: updated.status },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath("/branches");
}

export async function updateBusinessAction(formData: FormData) {
  const user = await requireUser();
  const auditRequest = await getAuditRequestContext();
  const businessId = formData.get("businessId")?.toString();

  if (!businessId) {
    throw new Error("Business id is required.");
  }

  assertCanManageBusiness(user, businessId);

  const current = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!current) {
    throw new Error("Business not found, please login again");
  }

  const parsed = businessSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug") ?? current.slug,
    companyNo: formData.get("companyNo"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    address: formData.get("address"),
    status: user.role === "PLATFORM_ADMIN" ? formData.get("status") : current.status,
  });
  const logoUrl = await saveBusinessLogo(formData.get("logo"), businessId);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.business.update({
      where: { id: businessId },
      data: {
        name: parsed.name,
        companyNo: parsed.companyNo || null,
        phone: parsed.phone || null,
        email: parsed.email || null,
        address: parsed.address || null,
        status: parsed.status,
        ...(logoUrl ? { logoUrl } : {}),
      },
    });

    await writeAuditLog(
      {
        businessId,
        actor: user,
        action: "BUSINESS_UPDATED",
        entityType: "Business",
        entityId: businessId,
        summary: `Updated business ${updated.name}`,
        before: current,
        after: updated,
        metadata: { logoChanged: Boolean(logoUrl) },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/admin/businesses");
  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath("/business/settings");

  if (user.role === "PLATFORM_ADMIN") {
    redirect(`/admin/businesses/${businessId}`);
  }

  redirect("/business/settings");
}

async function saveBusinessLogo(fileEntry: FormDataEntryValue | null, businessId: string) {
  if (!fileEntry || typeof fileEntry === "string" || fileEntry.size === 0) {
    return null;
  }

  if (fileEntry.size > LOGO_MAX_BYTES) {
    throw new Error("Logo file must be smaller than 2MB.");
  }

  const extension = LOGO_EXTENSIONS.get(fileEntry.type);

  if (!extension) {
    throw new Error("Logo must be a PNG, JPG, or WebP image.");
  }

  await mkdir(LOGO_UPLOAD_DIR, { recursive: true });

  const filename = `${businessId}-${randomUUID()}.${extension}`;
  const filePath = path.join(LOGO_UPLOAD_DIR, filename);
  await writeFile(filePath, Buffer.from(await fileEntry.arrayBuffer()));

  return `/uploads/business-logos/${filename}`;
}

export type AdminResetUserPasswordState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type AdminUpdateUserEmailState = AdminResetUserPasswordState;

export async function adminUpdateUserEmailAction(
  _previousState: AdminUpdateUserEmailState,
  formData: FormData,
): Promise<AdminUpdateUserEmailState> {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const auditRequest = await getAuditRequestContext();

  try {
    const input = adminUpdateUserEmailSchema.parse({
      businessId: formData.get("businessId"),
      userId: formData.get("userId"),
      email: formData.get("email"),
    });
    const email = input.email.toLowerCase();

    const targetUser = await prisma.user.findFirst({
      where: {
        id: input.userId,
        businessId: input.businessId,
        role: { in: ["BUSINESS_OWNER", "STAFF"] },
      },
      select: { id: true, email: true },
    });

    if (!targetUser) {
      return { status: "error", message: "User not found for this business." };
    }

    if (targetUser.email.toLowerCase() === email) {
      return { status: "success", message: "Login email is unchanged." };
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return { status: "error", message: "Login email already exists." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUser.id },
        data: { email },
      });

      await writeAuditLog(
        {
          businessId: input.businessId,
          actor: user,
          action: "USER_LOGIN_EMAIL_UPDATED",
          entityType: "User",
          entityId: targetUser.id,
          summary: "Updated user login email",
          before: { email: targetUser.email },
          after: { email },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath(`/admin/businesses/${input.businessId}`);

    return { status: "success", message: "Login email updated successfully." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to update login email.",
    };
  }
}

export async function adminResetUserPasswordAction(
  _previousState: AdminResetUserPasswordState,
  formData: FormData,
): Promise<AdminResetUserPasswordState> {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const auditRequest = await getAuditRequestContext();

  try {
    const input = adminResetUserPasswordSchema.parse({
      businessId: formData.get("businessId"),
      userId: formData.get("userId"),
      newPassword: formData.get("newPassword"),
    });

    const targetUser = await prisma.user.findFirst({
      where: {
        id: input.userId,
        businessId: input.businessId,
        role: { in: ["BUSINESS_OWNER", "STAFF"] },
      },
      select: { id: true },
    });

    if (!targetUser) {
      return {
        status: "error",
        message: "User not found for this business.",
      };
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUser.id },
        data: { passwordHash },
      });

      await writeAuditLog(
        {
          businessId: input.businessId,
          actor: user,
          action: "USER_PASSWORD_RESET",
          entityType: "User",
          entityId: targetUser.id,
          summary: "Reset user login password",
          metadata: { passwordReset: true },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath(`/admin/businesses/${input.businessId}`);

    return {
      status: "success",
      message: "Password updated successfully.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to update password.",
    };
  }
}

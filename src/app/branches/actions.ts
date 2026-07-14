"use server";

import { revalidatePath } from "next/cache";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { branchSchema } from "@/lib/validation/branches";

async function requireBranchManager() {
  const context = await requireBusinessUser();
  assertStaffPermission(context.user, "BRANCHES");

  return context;
}

export async function updateBranchAction(formData: FormData) {
  const { businessId, user } = await requireBranchManager();
  const auditRequest = await getAuditRequestContext();
  const branchId = formData.get("branchId")?.toString();

  if (!branchId) {
    throw new Error("Branch id is required.");
  }

  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      businessId,
    },
  });

  if (!branch) {
    throw new Error("Branch not found for this business.");
  }

  const input = branchSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    status: branch.status,
  });

  const duplicate = await prisma.branch.findFirst({
    where: {
      businessId,
      name: input.name,
      id: { not: branch.id },
    },
  });

  if (duplicate) {
    throw new Error("Branch name already exists in this business.");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.branch.update({
      where: { id: branch.id },
      data: {
        name: input.name,
        phone: input.phone || null,
        address: input.address || null,
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: branch.id,
        actor: user,
        action: "BRANCH_UPDATED",
        entityType: "Branch",
        entityId: branch.id,
        summary: `Updated branch ${updated.name}`,
        before: branch,
        after: updated,
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/branches");
  revalidatePath(`/branches/${branch.id}`);
}

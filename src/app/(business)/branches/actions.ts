"use server";

import { requireBusinessUser } from "@/lib/auth/business-user";

export async function updateBranchAction() {
  await requireBusinessUser();
  throw new Error("Branches are managed by the platform administrator.");
}

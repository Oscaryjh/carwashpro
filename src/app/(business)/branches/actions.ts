"use server";

import { requireBusinessUser } from "@/lib/auth/business-user";

export async function updateBranchAction() {
  await requireBusinessUser("MODIFY_BUSINESS_SETTINGS");
  throw new Error("Branches are managed by the platform administrator.");
}

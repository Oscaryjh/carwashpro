import { requireBusinessUser } from "@/lib/auth/business-user";

export async function requireCrmUser() {
  return requireBusinessUser();
}

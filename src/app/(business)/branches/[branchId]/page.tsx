import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";

export default async function BranchDetailsPage() {
  await requireBusinessUser("MODIFY_BUSINESS_SETTINGS");
  redirect(
    "/business/settings?type=error&message=Branches%20are%20managed%20by%20the%20platform%20administrator.",
  );
}

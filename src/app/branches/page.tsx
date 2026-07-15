import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";

export default async function BranchesPage() {
  await requireBusinessUser();
  redirect(
    "/business/settings?type=error&message=Branches%20are%20managed%20by%20the%20platform%20administrator.",
  );
}

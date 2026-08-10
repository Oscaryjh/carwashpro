import type { Metadata } from "next";
import { StaffClaims } from "@/components/staff-pwa/staff-claims";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "Claims" };

export default async function StaffClaimsPage() {
  await requireEmployeeModulePage("CLAIMS");
  return <StaffClaims />;
}

import type { Metadata } from "next";
import { StaffHistory } from "@/components/staff-pwa/staff-history";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = {
  title: "History",
};

export default async function StaffHistoryPage() {
  await requireEmployeeModulePage("HR");
  return <StaffHistory />;
}

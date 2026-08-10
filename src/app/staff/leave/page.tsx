import type { Metadata } from "next";
import { StaffLeave } from "@/components/staff-pwa/staff-leave";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "Leave" };

export default async function StaffLeavePage() {
  await requireEmployeeModulePage("HR");
  return <StaffLeave />;
}

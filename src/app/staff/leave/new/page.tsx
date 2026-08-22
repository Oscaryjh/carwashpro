import type { Metadata } from "next";
import { StaffLeave } from "@/components/staff-pwa/staff-leave";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "New leave request" };

export default async function StaffNewLeaveRequestPage() {
  await requireEmployeeModulePage("HR");
  return <StaffLeave view="new-request" />;
}

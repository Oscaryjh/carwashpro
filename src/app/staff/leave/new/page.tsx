import type { Metadata } from "next";
import { StaffLeave } from "@/components/staff-pwa/staff-leave";
import { StaffTaskNavigation } from "@/components/staff-pwa/staff-task-navigation";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "New leave request" };

export default async function StaffNewLeaveRequestPage() {
  await requireEmployeeModulePage("HR");
  return <><StaffTaskNavigation /><StaffLeave view="new-request" /></>;
}

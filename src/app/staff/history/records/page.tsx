import type { Metadata } from "next";
import { StaffHistory } from "@/components/staff-pwa/staff-history";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "Attendance history" };

export default async function StaffAttendanceHistoryPage() {
  await requireEmployeeModulePage("HR");
  return <StaffHistory />;
}

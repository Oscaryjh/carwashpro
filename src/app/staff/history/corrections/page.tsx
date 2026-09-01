import type { Metadata } from "next";
import { StaffAttendanceCorrectionsV2 } from "@/components/staff-pwa/staff-attendance-corrections-v2";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "Attendance corrections" };

export default async function StaffAttendanceCorrectionsPage() {
  await requireEmployeeModulePage("HR");
  return <StaffAttendanceCorrectionsV2 />;
}

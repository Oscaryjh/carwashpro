import type { Metadata } from "next";
import { StaffToday } from "@/components/staff-pwa/staff-today";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = {
  title: "Today",
};

export default async function StaffTodayPage() {
  await requireEmployeeModulePage("HR");

  return <StaffToday />;
}

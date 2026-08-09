import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffToday } from "@/components/staff-pwa/staff-today";
import { getEmployeeAuthContext } from "@/lib/attendance/employee-auth/session";

export const metadata: Metadata = {
  title: "Today",
};

export default async function StaffTodayPage() {
  const auth = await getEmployeeAuthContext();
  if (!auth) redirect("/staff/login");

  return <StaffToday />;
}

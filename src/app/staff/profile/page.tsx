import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffProfile } from "@/components/staff-pwa/staff-profile";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function StaffProfilePage() {
  if (!(await getEmployeeSelfServiceAuthContext())) redirect("/staff/login");
  return <StaffProfile />;
}

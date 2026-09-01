import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffProfile } from "@/components/staff-pwa/staff-profile";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";

export const metadata: Metadata = {
  title: "Profile",
};

type StaffProfilePageProps = {
  searchParams: Promise<{ device?: string | string[] }>;
};

export default async function StaffProfilePage({ searchParams }: StaffProfilePageProps) {
  if (!(await getEmployeeSelfServiceAuthContext())) redirect("/staff/login");
  const { device } = await searchParams;
  return <StaffProfile deviceVerified={device === "verified"} />;
}

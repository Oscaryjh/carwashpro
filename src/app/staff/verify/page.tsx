import type { Metadata } from "next";
import { StaffVerifyForm } from "@/components/staff-pwa/staff-auth";
import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";

export const metadata: Metadata = {
  title: "Verify code",
};

export default function StaffVerifyPage() {
  const config = getEmployeeAuthConfig();
  return <StaffVerifyForm developmentFastPath={config.otp.developmentFastPath} />;
}

import type { Metadata } from "next";
import { StaffLoginForm } from "@/components/staff-pwa/staff-auth";
import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";

export const metadata: Metadata = {
  title: "Employee sign in",
};

type StaffLoginPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function StaffLoginPage({ searchParams }: StaffLoginPageProps) {
  const { reason } = await searchParams;
  const initialMessage =
    reason === "device-revoked"
      ? "This device has been revoked. Verify again or contact your administrator."
      : reason === "session-expired"
        ? "Your Employee Session has expired. Sign in again."
        : reason === "logged-out"
          ? "You have signed out securely."
          : "";

  const config = getEmployeeAuthConfig();
  return (
    <StaffLoginForm
      initialMessage={initialMessage}
      initialMessageTone={reason === "logged-out" ? "success" : "error"}
      testingMode={config.otp.sendMode === "mock"}
    />
  );
}

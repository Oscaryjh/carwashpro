import type { Metadata } from "next";
import { StaffVerifyForm } from "@/components/staff-pwa/staff-auth";

export const metadata: Metadata = {
  title: "Verify code",
};

export default function StaffVerifyPage() {
  return <StaffVerifyForm />;
}

import type { Metadata } from "next";
import { StaffLeave } from "@/components/staff-pwa/staff-leave";

export const metadata: Metadata = { title: "Leave" };

export default function StaffLeavePage() {
  return <StaffLeave />;
}

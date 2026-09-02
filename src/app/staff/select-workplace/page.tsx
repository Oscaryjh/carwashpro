import type { Metadata } from "next";
import { StaffWorkplaceSelector } from "@/components/staff-pwa/staff-auth";

export const metadata: Metadata = {
  title: "Select workplace",
};

export default function StaffSelectWorkplacePage() {
  return <StaffWorkplaceSelector />;
}

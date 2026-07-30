import type { Metadata } from "next";
import { StaffProfile } from "@/components/staff-pwa/staff-profile";

export const metadata: Metadata = {
  title: "Profile",
};

export default function StaffProfilePage() {
  return <StaffProfile />;
}

import type { Metadata } from "next";
import { StaffToday } from "@/components/staff-pwa/staff-today";

export const metadata: Metadata = {
  title: "Today",
};

export default function StaffTodayPage() {
  return <StaffToday />;
}

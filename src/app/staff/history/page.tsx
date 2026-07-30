import type { Metadata } from "next";
import { StaffHistory } from "@/components/staff-pwa/staff-history";

export const metadata: Metadata = {
  title: "History",
};

export default function StaffHistoryPage() {
  return <StaffHistory />;
}

import type { Metadata } from "next";
import { StaffProfile } from "@/components/staff-pwa/staff-profile";

export const metadata: Metadata = {
  title: "Verified device",
};

type StaffDevicePageProps = {
  searchParams: Promise<{ verified?: string }>;
};

export default async function StaffDevicePage({ searchParams }: StaffDevicePageProps) {
  const { verified } = await searchParams;
  return <StaffProfile deviceVerified={verified === "1"} />;
}

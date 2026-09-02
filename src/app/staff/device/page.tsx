import { redirect } from "next/navigation";

type StaffDevicePageProps = {
  searchParams: Promise<{ verified?: string | string[] }>;
};

export default async function StaffDevicePage({ searchParams }: StaffDevicePageProps) {
  const { verified } = await searchParams;
  redirect(verified === "1" ? "/staff/profile?device=verified" : "/staff/profile");
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { loadCompanyLocationView } from "@/lib/attendance/company-location-view";
import { CompanyClockInLocation, CompanyLocationSaveProvider } from "@/components/company-clock-in-location";
import { saveCompanyClockInLocationAction } from "./actions";

export default async function ClockInLocationPage() {
  const { access, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_SETTINGS");
  if (access.effectiveBusinessRole === "BUSINESS_OWNER") redirect("/business/settings?panel=clock-in-location#clock-in-location");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true, name: true } });
  const view = await loadCompanyLocationView(access, true, business.timezone);
  return <section className="content"><h1>Business details · Clock-in location</h1><Link href="/team/attendance-settings">Back to Attendance Settings</Link><CompanyLocationSaveProvider action={saveCompanyClockInLocationAction}><CompanyClockInLocation view={view} businessName={business.name} /></CompanyLocationSaveProvider></section>;
}

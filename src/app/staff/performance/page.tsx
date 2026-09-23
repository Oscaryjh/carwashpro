import { redirect, notFound } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { staffPerformanceEnabled, staffPerformanceScopeKey } from "@/lib/staff-pwa/performance-access";
import { StaffPerformance } from "@/components/staff-pwa/staff-performance";
export const dynamic = "force-dynamic";
export const metadata = { title: "Performance" };
export default async function StaffPerformancePage() {
  if (!staffPerformanceEnabled()) notFound();
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  return <StaffPerformance key={staffPerformanceScopeKey(auth)} scopeKey={staffPerformanceScopeKey(auth)} />;
}

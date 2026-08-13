import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffHomeOverview } from "@/components/staff-pwa/staff-home-overview";
import { StaffToday } from "@/components/staff-pwa/staff-today";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { getStaffHomeOverview } from "@/lib/staff-pwa/home";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function StaffHomePage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const context = await loadBusinessModuleContext(auth.businessId);
  const modules = [...context.enabledModules];
  const overview = await getStaffHomeOverview(auth, modules);

  return (
    <div className="staff-home-stack">
      {context.enabledModules.has("HR") ? <StaffToday /> : null}
      <StaffHomeOverview overview={overview} />
    </div>
  );
}

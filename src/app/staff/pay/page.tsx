import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffPayHubV2 } from "@/components/staff-pwa/staff-pay-hub-v2";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { loadPublishedPayslipsForEmployee } from "@/lib/payroll/payslip-publication";

export const metadata: Metadata = { title: "Pay" };
export const dynamic = "force-dynamic";

export default async function StaffPayPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");

  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const payrollEnabled = enabledModules.has("PAYROLL");
  const commissionEnabled = enabledModules.has("COMMISSION");

  if (!payrollEnabled && !commissionEnabled) {
    redirect("/staff/module-not-enabled?module=PAYROLL");
  }

  const payslips = payrollEnabled
    ? await loadPublishedPayslipsForEmployee({
        businessId: auth.businessId,
        membershipId: auth.membershipId,
      })
    : [];
  const latestPayslip = payslips[0];

  return (
    <StaffPayHubV2
      commissionEnabled={commissionEnabled}
      latestPayslip={latestPayslip
        ? {
            grossPay: latestPayslip.payrollEntry.grossPay,
            id: latestPayslip.id,
            netPay: latestPayslip.payrollEntry.netPay,
            periodStart: latestPayslip.payrollRun.periodStart,
          }
        : null}
      payrollEnabled={payrollEnabled}
    />
  );
}

import type { Metadata } from "next";
import { StaffPayslipsV2 } from "@/components/staff-pwa/staff-payslips-v2";
import { loadPublishedPayslipsForEmployee } from "@/lib/payroll/payslip-publication";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "My payslips" };
export const dynamic = "force-dynamic";

export default async function StaffPayslipsPage() {
  const auth = await requireEmployeeModulePage("PAYROLL");
  const payslips = await loadPublishedPayslipsForEmployee({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
  });
  return <StaffPayslipsV2 payslips={payslips.map((payslip) => ({
    id: payslip.id,
    netPay: payslip.payrollEntry.netPay,
    periodStart: payslip.payrollRun.periodStart,
    publishedAt: payslip.publishedAt,
  }))} />;
}

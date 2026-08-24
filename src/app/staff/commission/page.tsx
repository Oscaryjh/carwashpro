import type { Metadata } from "next";
import { getEmployeeCommissionStatements } from "@/lib/commission/read";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "My commission" };
export const dynamic = "force-dynamic";

export default async function StaffCommissionPage() {
  const auth = await requireEmployeeModulePage("COMMISSION");
  const statements = await getEmployeeCommissionStatements({ businessId: auth.businessId, membershipId: auth.membershipId });
  return <section className="staff-page-card" aria-labelledby="staff-commission-heading"><div className="staff-payslip-heading"><p>Commission</p><h1 id="staff-commission-heading">My commission</h1><span>Estimated amounts are pending review. Approved amounts are frozen and will not change when rates are updated later.</span></div>{statements.length ? <div className="staff-payslip-list">{statements.map((statement) => <article key={statement.id}><div><strong>{statement.period.earnedPeriodStart.toISOString().slice(0,10)} – {statement.period.earnedPeriodEnd.toISOString().slice(0,10)}</strong><small>{statement.accruals.length} source line(s) · {commissionStatusLabel(statement.status)}</small></div><strong>RM {(statement.finalCommissionCents / 100).toFixed(2)}</strong></article>)}</div> : <div className="staff-payslip-empty"><strong>No commission yet</strong><span>Your estimated and approved commission statements will appear here.</span></div>}</section>;
}

function commissionStatusLabel(status: string) {
  if (status === "CALCULATED") return "Estimated · pending review";
  if (status === "APPROVED") return "Approved · frozen";
  if (status === "APPLIED_TO_PAYROLL") return "Approved · sent to Payroll";
  return "Statement available";
}

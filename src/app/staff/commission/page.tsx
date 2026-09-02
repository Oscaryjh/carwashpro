import type { Metadata } from "next";
import { getEmployeeCommissionStatements } from "@/lib/commission/read";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "My commission" };
export const dynamic = "force-dynamic";

export default async function StaffCommissionPage() {
  const auth = await requireEmployeeModulePage("COMMISSION");
  const statements = await getEmployeeCommissionStatements({ businessId: auth.businessId, membershipId: auth.membershipId });
  return <section className="staff-page-card" aria-labelledby="staff-commission-heading"><div className="staff-payslip-heading"><p>Commission statement</p><h1 id="staff-commission-heading">My commission</h1><span>This is a separate earnings statement. An approved amount is not necessarily included in your current payslip.</span></div>{statements.length ? <div className="staff-payslip-list">{statements.map((statement) => <article key={statement.id}><div><strong>{formatDate(statement.period.earnedPeriodStart)} – {formatDate(statement.period.earnedPeriodEnd)}</strong><small>{statement.accruals.length} earning line(s) · {commissionStatusLabel(statement.status)}</small></div><strong>RM {(statement.finalCommissionCents / 100).toFixed(2)}</strong></article>)}</div> : <div className="staff-payslip-empty"><strong>No commission statement yet</strong><span>Your estimated and approved commission statements will appear here separately from your payslips.</span></div>}</section>;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}

function commissionStatusLabel(status: string) {
  if (status === "CALCULATED") return "Estimated · pending review";
  if (status === "APPROVED") return "Approved · frozen";
  if (status === "APPLIED_TO_PAYROLL") return "Approved · sent to Payroll";
  return "Statement available";
}

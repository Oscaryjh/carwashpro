import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeCommissionStatements } from "@/lib/commission/read";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { loadPublishedPayslipsForEmployee } from "@/lib/payroll/payslip-publication";

export const metadata: Metadata = { title: "Pay" };
export const dynamic = "force-dynamic";

export default async function StaffPayPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const [payslips, statements] = await Promise.all([
    enabledModules.has("PAYROLL") ? loadPublishedPayslipsForEmployee({ businessId: auth.businessId, membershipId: auth.membershipId }) : [],
    enabledModules.has("COMMISSION") ? getEmployeeCommissionStatements({ businessId: auth.businessId, membershipId: auth.membershipId }) : [],
  ]);
  if (!enabledModules.has("PAYROLL") && !enabledModules.has("COMMISSION")) redirect("/staff/module-not-enabled?module=PAYROLL");

  return (
    <section className="staff-hub-page" aria-labelledby="staff-pay-heading">
      <header className="staff-section-hero"><p className="staff-kicker">MY PAY</p><h1 id="staff-pay-heading">Pay</h1><span>Published payroll records only. Draft or unfinalized amounts never appear here.</span></header>
      <div className="staff-hub-grid">
        {enabledModules.has("PAYROLL") ? <PayCard href="/staff/payslips" eyebrow="PAYROLL DOCUMENTS" title="Payslips" detail={payslips.length ? `${payslips.length} published document${payslips.length === 1 ? "" : "s"}` : "No published payslips yet"} /> : null}
        {enabledModules.has("COMMISSION") ? <PayCard href="/staff/commission" eyebrow="EARNINGS" title="Commission" detail={statements.length ? `${statements.length} calculated or approved statement${statements.length === 1 ? "" : "s"}` : "No commission statements yet"} /> : null}
      </div>
      <div className="staff-hub-note"><strong>Final records only</strong><span>Payslips come from finalized payroll snapshots. Commission shows the recorded statement status and does not imply payment.</span></div>
    </section>
  );
}

function PayCard({ href, eyebrow, title, detail }: { href: string; eyebrow: string; title: string; detail: string }) {
  return <Link className="staff-hub-card" href={href}><small>{eyebrow}</small><strong>{title}</strong><span>{detail}</span><b>View <span aria-hidden="true">→</span></b></Link>;
}

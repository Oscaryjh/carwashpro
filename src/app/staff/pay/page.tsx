import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { loadPublishedPayslipsForEmployee } from "@/lib/payroll/payslip-publication";

export const metadata: Metadata = { title: "Pay" };
export const dynamic = "force-dynamic";

export default async function StaffPayPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const payslips = enabledModules.has("PAYROLL")
    ? await loadPublishedPayslipsForEmployee({
        businessId: auth.businessId,
        membershipId: auth.membershipId,
      })
    : [];
  const latestPayslip = payslips[0];
  const items = [
    enabledModules.has("PAYROLL")
      ? {
          href: "/staff/payslips",
          eyebrow: "Payroll documents",
          title: "Payslips",
          detail: "View payslips made available to your account.",
        }
      : null,
    enabledModules.has("COMMISSION")
      ? {
          href: "/staff/commission",
          eyebrow: "Earnings",
          title: "Commission",
          detail: "View your separate commission statements and review status.",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!items.length) redirect("/staff/module-not-enabled?module=PAYROLL");

  return (
    <section className="staff-hub-page" aria-labelledby="staff-pay-heading">
      <header className="staff-hub-heading">
        <p className="staff-kicker">MY PAY</p>
        <h1 id="staff-pay-heading">Pay</h1>
        <span>Find available payslips and separate earnings statements.</span>
      </header>
      {enabledModules.has("PAYROLL") ? (
        latestPayslip ? (
          <article className="staff-pay-summary" aria-label="Latest available payslip">
            <div className="staff-pay-summary-heading">
              <div>
                <small>LATEST PAYSLIP</small>
                <h2>{formatMonth(latestPayslip.payrollRun.periodStart)}</h2>
              </div>
              <span>Available</span>
            </div>
            <div className="staff-money-summary">
              <span><small>Gross</small><strong>{money(latestPayslip.payrollEntry.grossPay)}</strong></span>
              <span className="net"><small>Net pay</small><strong>{money(latestPayslip.payrollEntry.netPay)}</strong></span>
            </div>
            <Link className="staff-primary-link" href={`/staff/payslips/${latestPayslip.id}`}>View payslip <span aria-hidden="true">→</span></Link>
          </article>
        ) : (
          <div className="staff-empty-state staff-pay-empty" role="status">
            <span aria-hidden="true">▤</span>
            <h2>Not available yet</h2>
            <p>Your payslip will appear here when your employer makes it available.</p>
          </div>
        )
      ) : null}
      <div className="staff-hub-grid">
        {items.map((item) => (
          <Link className="staff-hub-card" href={item.href} key={item.href}>
            <small>{item.eyebrow}</small>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <b>Open <span aria-hidden="true">→</span></b>
          </Link>
        ))}
      </div>
    </section>
  );
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}

function money(value: number | { toString(): string }) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(value));
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";

export const metadata: Metadata = { title: "Pay" };
export const dynamic = "force-dynamic";

export default async function StaffPayPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const items = [
    enabledModules.has("PAYROLL")
      ? {
          href: "/staff/payslips",
          eyebrow: "Payroll documents",
          title: "Payslips",
          detail: "View payslips your employer has finalized and published.",
        }
      : null,
    enabledModules.has("COMMISSION")
      ? {
          href: "/staff/commission",
          eyebrow: "Earnings",
          title: "Commission",
          detail: "See estimated and approved commission statements.",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!items.length) redirect("/staff/module-not-enabled?module=PAYROLL");

  return (
    <section className="staff-hub-page" aria-labelledby="staff-pay-heading">
      <header className="staff-hub-heading">
        <p className="staff-kicker">MY PAY</p>
        <h1 id="staff-pay-heading">Pay</h1>
        <span>Find your published pay documents and earnings statements.</span>
      </header>
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

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

export default async function StaffRequestsPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const items = [
    enabledModules.has("HR")
      ? {
          href: "/staff/leave",
          eyebrow: "Time away",
          title: "Leave",
          detail: "Request leave and check your balances and request history.",
        }
      : null,
    enabledModules.has("CLAIMS")
      ? {
          href: "/staff/claims",
          eyebrow: "Expenses",
          title: "Claims",
          detail: "Submit an expense claim, attach a receipt and follow its status.",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!items.length) redirect("/staff/module-not-enabled?module=HR");

  return (
    <section className="staff-hub-page" aria-labelledby="staff-requests-heading">
      <header className="staff-hub-heading">
        <p className="staff-kicker">MY REQUESTS</p>
        <h1 id="staff-requests-heading">Requests</h1>
        <span>Start a request or return to one you already submitted.</span>
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

import type { Metadata } from "next";
import Link from "next/link";
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
  return (
    <section className="staff-payslip-page" aria-labelledby="staff-payslip-heading">
      <div className="staff-payslip-heading">
        <p>Payroll documents</p>
        <h1 id="staff-payslip-heading">My payslips</h1>
        <span>Only payslips published to your own employee account appear here.</span>
      </div>
      {payslips.length ? (
        <div className="staff-payslip-list">
          {payslips.map((payslip) => (
            <article key={payslip.id}>
              <div>
                <strong>{formatMonth(payslip.payrollRun.periodStart)}</strong>
                <small>Published {formatDate(payslip.publishedAt)}</small>
                <span className="staff-payslip-inline-summary">
                  Gross {money(payslip.payrollEntry.grossPay)} · Deductions {money(Number(payslip.payrollEntry.grossPay) - Number(payslip.payrollEntry.netPay))} · <b>Net {money(payslip.payrollEntry.netPay)}</b>
                </span>
              </div>
              <Link href={`/staff/payslips/${payslip.id}`}>View payslip</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="staff-payslip-empty" role="status">
          <strong>No published payslips</strong>
          <span>Your employer has not published a payslip to this account yet.</span>
        </div>
      )}
    </section>
  );
}

function money(value: number | { toString(): string }) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(value));
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

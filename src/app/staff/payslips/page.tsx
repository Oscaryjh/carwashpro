import type { Metadata } from "next";
import Link from "next/link";
import { loadPublishedPayslipsForEmployee } from "@/lib/payroll/payslip-publication";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "Payslips" };
export const dynamic = "force-dynamic";

export default async function StaffPayslipsPage() {
  const auth = await requireEmployeeModulePage("PAYROLL");
  const payslips = await loadPublishedPayslipsForEmployee({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
  });
  return (
    <section className="staff-payslip-page" aria-labelledby="staff-payslip-heading">
      <div className="staff-payslip-heading staff-section-hero">
        <p>Payslips</p>
        <h1 id="staff-payslip-heading">Payroll documents</h1>
        <span>Download documents published to your employee account.</span>
      </div>
      {payslips.length ? (
        <div className="staff-payslip-list">
          {payslips.map((payslip) => (
            <article key={payslip.id}>
              <div>
                <strong>{formatMonth(payslip.payrollRun.periodStart)}</strong>
                <small>Published {formatDate(payslip.publishedAt)}</small>
              </div>
              <Link href={`/staff/payslips/${payslip.id}`}>Download PDF</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="staff-payslip-empty" role="status">
          <strong>No documents yet</strong>
          <span>Your employer has not published anything to this account.</span>
        </div>
      )}
    </section>
  );
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

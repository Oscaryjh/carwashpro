"use client";

export default function StaffPayslipsError({ reset }: { reset: () => void }) {
  return (
    <section className="staff-payslip-page" aria-labelledby="staff-payslip-error-heading">
      <div className="staff-payslip-empty" role="alert">
        <strong id="staff-payslip-error-heading">Payslips could not be loaded</strong>
        <span>No stale or unpublished payroll document is shown.</span>
        <button type="button" onClick={reset}>Try again</button>
      </div>
    </section>
  );
}

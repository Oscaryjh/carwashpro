export default function StaffPayslipsLoading() {
  return (
    <section
      className="staff-payslip-page"
      aria-busy="true"
      aria-labelledby="staff-payslip-loading-heading"
    >
      <div className="staff-payslip-heading staff-section-hero">
        <p>PAYSLIPS</p>
        <h1 id="staff-payslip-loading-heading">Loading documents</h1>
        <span>Checking publications for your employee account.</span>
      </div>
    </section>
  );
}

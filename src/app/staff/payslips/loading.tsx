export default function StaffPayslipsLoading() {
  return (
    <section
      className="staff-payslip-page"
      aria-busy="true"
      aria-labelledby="staff-payslip-loading-heading"
    >
      <div className="staff-payslip-heading">
        <p>Payroll documents</p>
        <h1 id="staff-payslip-loading-heading">Loading payslips</h1>
        <span>Checking the payslips published to your employee account.</span>
      </div>
    </section>
  );
}

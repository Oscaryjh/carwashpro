import { staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffTimesheetLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading timesheet and overtime"
      className={staffV2Styles.scope}
    >
      <div className={`${staffV2Styles.pageHeader} ${staffV2Styles.pageHeaderNoLeading}`}>
        <div className={staffV2Styles.pageHeaderCopy}>
          <h1>Timesheet & overtime</h1>
          <p>Monthly work results used for review and payroll.</p>
        </div>
      </div>
      <div className={staffV2Styles.skeleton} style={{ minHeight: 44 }} />
      <div className={staffV2Styles.skeleton} style={{ minHeight: 42 }} />
      {Array.from({ length: 3 }, (_, index) => (
        <div className={staffV2Styles.skeleton} key={index} />
      ))}
      <span className={staffV2Styles.srOnly}>Loading timesheet and overtime…</span>
    </section>
  );
}

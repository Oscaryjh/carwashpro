import styles from "./timesheets.module.css";

export default function LoadingAttendanceTimesheets() {
  return <main className={styles.page}><div className={styles.loading}><strong>Loading monthly Timesheet</strong><span>Checking current Final Attendance Results and branch readiness.</span></div></main>;
}

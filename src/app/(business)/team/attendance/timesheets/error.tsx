"use client";

import Link from "next/link";
import styles from "./timesheets.module.css";

export default function AttendanceTimesheetsError({ reset }: { reset: () => void }) {
  return <main className={styles.page}><div className={styles.loading}><strong>Monthly Timesheet could not be loaded</strong><span>No Attendance or Payroll data was changed.</span><div><button onClick={reset} type="button">Try again</button> <Link href="/team/attendance">Return to Attendance</Link></div></div></main>;
}

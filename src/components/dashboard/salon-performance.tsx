import type { SalonPerformance } from "@/lib/business-performance/salon-performance";
import { formatReportMoney } from "@/lib/reports/presentation";
import styles from "./salon-performance.module.css";
import Link from "next/link";
import { staffPerformanceHref, type StaffPerformanceQuery } from "@/lib/business-performance/staff-performance-navigation";
import type { PerformanceRange } from "@/lib/business-performance/read-model";
import type { ReactNode } from "react";

export function SalonPerformanceSection({ data, query = {}, range = "today", monthHref, children }: {
  data: SalonPerformance | null; query?: StaffPerformanceQuery; range?: PerformanceRange; monthHref?: string; children?: ReactNode;
}) {
  if (!data) return null;
  const staff = data.staffSales.filter(row => row.amount !== 0 || row.appointments > 0);
  const hasAppointments = data.totalAppointments > 0 || data.repeatCustomers > 0;
  if (!staff.length && !hasAppointments) {
    const periodCopy: Record<PerformanceRange, string> = {
      today: "No staff activity today.", yesterday: "No staff activity yesterday.",
      this_week: "No staff activity this week.", last_week: "No staff activity last week.",
      month: "No staff activity this month.", last_month: "No staff activity last month.",
      custom: "No staff activity in this period.", "7days": "No staff activity in this period.",
    };
    return <section aria-label="Performance" className={styles.section}>
      <h2>Performance</h2>
      <div className={`panel ${styles.empty}`}>
        <p>{periodCopy[range]}</p>
        {range !== "month" && monthHref ? <Link className={styles.monthAction} href={monthHref}>View this month</Link> : null}
      </div>
      {children}
    </section>;
  }
  const activeAppointments = data.statusRows.find(row => row.status === "SCHEDULED")?.appointments ?? 0;
  const otherStatuses = data.statusRows
    .filter(row => row.appointments > 0 && !["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(row.status));

  return <section aria-label="Performance" className={styles.section}>
    <h2>Performance</h2>
    <div className={styles.grid}>
      {staff.length ? <div className={`panel ${styles.card}`}>
        <h3>Top Staff</h3>
        <table className={styles.staff}>
          <thead><tr><th>Staff</th><th>Appointments</th><th>Attributed Sales</th><th>View</th></tr></thead>
          <tbody>{staff.map(row => <tr key={row.id}>
            <td>{row.name}</td><td>{row.appointments}</td><td>{formatReportMoney(row.amount)}</td>
            <td><Link className={styles.view} href={staffPerformanceHref(row.id, query)} aria-label={`View ${row.name} performance`}>View →</Link></td>
          </tr>)}</tbody>
        </table>
      </div> : null}
      {hasAppointments ? <div className={`panel ${styles.card}`}>
        <h3>Appointments</h3>
        <p className={styles.status}>{data.totalAppointments} total</p>
        <dl className={styles.summary}>
          <div><dt>Active appointments</dt><dd>{activeAppointments}</dd></div>
          <div><dt>Completed</dt><dd>{data.completedAppointments}</dd></div>
          <div><dt>Cancelled</dt><dd>{data.cancelledAppointments}</dd></div>
          <div><dt>No-show</dt><dd>{data.noShowAppointments}</dd></div>
          {otherStatuses.map(row => <div key={row.status}><dt>{row.status.charAt(0) + row.status.slice(1).toLowerCase().replaceAll("_", " ")}</dt><dd>{row.appointments}</dd></div>)}
          <div><dt>Repeat customers</dt><dd>{data.repeatCustomers}</dd></div>
        </dl>
      </div> : null}
    </div>
    {children}
  </section>;
}

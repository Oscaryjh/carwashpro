import type { SalonPerformance } from "@/lib/business-performance/salon-performance";
import { formatReportMoney } from "@/lib/reports/presentation";
import styles from "./salon-performance.module.css";

export function SalonPerformanceSection({ data }: { data: SalonPerformance | null }) {
  if (!data) return null;
  const staff = data.staffSales.filter(row => row.amount !== 0 || row.appointments > 0);
  const hasAppointments = data.totalAppointments > 0 || data.repeatCustomers > 0;
  if (!staff.length && !hasAppointments) return null;
  const otherStatuses = data.statusRows
    .filter(row => row.appointments > 0 && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(row.status))
    .map(row => `${row.appointments} ${row.status.toLowerCase().replaceAll("_", " ")}`).join(" · ");

  return <section aria-label="Performance" className={styles.section}>
    <h2>Performance</h2>
    <div className={styles.grid}>
      {staff.length ? <div className={`panel ${styles.card}`}>
        <h3>Top Staff</h3>
        <table className={styles.staff}>
          <thead><tr><th>Staff</th><th>Appointments</th><th>Attributed Sales</th></tr></thead>
          <tbody>{staff.map(row => <tr key={row.id}>
            <td>{row.name}</td><td>{row.appointments}</td><td>{formatReportMoney(row.amount)}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}
      {hasAppointments ? <div className={`panel ${styles.card}`}>
        <h3>Appointments</h3>
        <p className={styles.status}>{otherStatuses || `${data.totalAppointments} ${data.totalAppointments === 1 ? "appointment" : "appointments"}`}</p>
        <dl className={styles.summary}>
          <div><dt>Completed</dt><dd>{data.completedAppointments}</dd></div>
          <div><dt>Cancelled</dt><dd>{data.cancelledAppointments}</dd></div>
          <div><dt>No-show</dt><dd>{data.noShowAppointments}</dd></div>
          <div><dt>Repeat visits</dt><dd>{data.repeatCustomers}</dd></div>
        </dl>
      </div> : null}
    </div>
  </section>;
}

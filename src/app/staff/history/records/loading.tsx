import { HistorySkeleton } from "@/components/staff-pwa/staff-history";
import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-attendance-history-v2.module.css";

export default function StaffAttendanceHistoryLoading() {
  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader
        title="Attendance history"
        meta="Your actual clock-ins and worked time."
      />
      <HistorySkeleton />
    </section>
  );
}

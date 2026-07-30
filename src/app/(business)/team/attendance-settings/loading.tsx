import styles from "./attendance-settings.module.css";

export default function AttendanceSettingsLoading() {
  return (
    <section className={`content ${styles.page}`} aria-busy="true">
      <div className={styles.loadingTitle} />
      <div className={styles.loadingGrid}>
        <div />
        <div />
        <div />
      </div>
      <span className="sr-only">Loading Attendance Settings</span>
    </section>
  );
}

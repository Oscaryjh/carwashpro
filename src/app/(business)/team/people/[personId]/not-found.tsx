import Link from "next/link";
import styles from "@/components/employee-profile-shell.module.css";

export default function EmployeeProfileNotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.state} data-tone="empty">
        <span aria-hidden="true" className={styles.stateIcon}>?</span>
        <div>
          <p className={styles.eyebrow}>Not found</p>
          <h2>Employee profile is unavailable</h2>
          <p>The employee does not exist, belongs to another business, or is outside your authorized branch scope.</p>
          <div className={styles.errorActions}>
            <Link href="/team?section=people">Back to People</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

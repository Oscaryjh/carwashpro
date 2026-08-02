import Link from "next/link";
import styles from "../runs.module.css";

export default function PayrollRunNotFound() {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <section className={styles.statePanel}>
        <span className={styles.stateMark} aria-hidden="true">?</span>
        <div>
          <p className={styles.eyebrow}>Not found</p>
          <h1>Payroll run not found</h1>
          <p>The run does not exist in the active business or is no longer available.</p>
          <Link href="/team/payroll/runs">Back to Payroll Runs</Link>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { PageHeader } from "../../../_components";
import styles from "../../../runs.module.css";

export default function PayrollEntryEditorNotFound() {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader title="Payroll entry not found" />
      <section className={styles.statePanel}>
        <span className={styles.stateMark} aria-hidden="true">?</span>
        <div>
          <p className={styles.eyebrow}>Not available</p>
          <h2>This entry cannot be edited</h2>
          <p>The entry may not exist in this business, or the Payroll Run is no longer in Draft.</p>
          <Link href="/team/payroll/runs">Back to Payroll Runs</Link>
        </div>
      </section>
    </main>
  );
}

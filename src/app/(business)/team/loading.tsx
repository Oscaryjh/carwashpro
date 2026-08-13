import styles from "@/components/hr-payroll-workspace.module.css";

export default function TeamLoading() {
  return (
    <section aria-busy="true" aria-live="polite" className={styles.routeState}>
      <span aria-hidden="true" className={styles.routeSpinner} />
      <h2>Loading workforce data</h2>
      <p>Preparing the latest records for this HR or Payroll workspace.</p>
    </section>
  );
}

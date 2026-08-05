import styles from "./payments.module.css";
export default function PaymentsLoading() { return <main className={`content hr-module-page ${styles.page}`}><section className={styles.statePanel} aria-live="polite"><strong>Loading payroll payments…</strong><p>Checking authorization before loading payment data.</p></section></main>; }

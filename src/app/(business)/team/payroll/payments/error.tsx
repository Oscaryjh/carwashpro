"use client";
import styles from "./payments.module.css";
export default function PaymentsError({ reset }: { error: Error; reset: () => void }) { return <main className={`content hr-module-page ${styles.page}`}><section className={`${styles.statePanel} ${styles.denied}`} role="alert"><h1>Payroll Payments could not be loaded</h1><p>No payment data was changed. Refresh and try again.</p><button className={styles.secondaryButton} onClick={reset} type="button">Try again</button></section></main>; }

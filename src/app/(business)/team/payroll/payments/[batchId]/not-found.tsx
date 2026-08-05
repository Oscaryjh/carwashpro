import Link from "next/link";
import styles from "../payments.module.css";
export default function PaymentBatchNotFound() { return <main className={`content hr-module-page ${styles.page}`}><section className={styles.statePanel}><h1>Payment batch not found</h1><p>The batch does not exist in the active Business Context, or you cannot access it.</p><Link href="/team/payroll/payments">Back to payment batches</Link></section></main>; }

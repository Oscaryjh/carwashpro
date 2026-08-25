import styles from "./commission.module.css";

export default function CommissionLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading commission">
      <div className={styles.loadingHeader} />
      <section className={styles.loadingSummary}><div /><div /><div /></section>
      <section className={styles.loadingPanel}><div /><div /><div /></section>
    </main>
  );
}

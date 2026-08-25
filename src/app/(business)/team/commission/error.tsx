"use client";

import styles from "./commission.module.css";

export default function CommissionError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.loadError}>
        <span aria-hidden="true">!</span>
        <div>
          <h1>Unable to load commission settings</h1>
          <p>Refresh the data and try again. Your saved commission records have not been changed.</p>
          <button onClick={reset} type="button">Try again</button>
        </div>
      </section>
    </main>
  );
}

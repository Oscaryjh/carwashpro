import styles from "@/components/employee-profile-shell.module.css";

export default function EmployeeProfileLoading() {
  return (
    <main aria-busy="true" aria-label="Loading employee profile" className={styles.page}>
      <section className={styles.header}>
        <div className={styles.identity}>
          <span aria-hidden="true" className={styles.avatar}>...</span>
          <div>
            <p className={styles.eyebrow}>HR &amp; Payroll / Employee Profile</p>
            <h1>Loading profile</h1>
            <div className={styles.meta}><span>Checking authorized scope</span></div>
          </div>
        </div>
      </section>
      <section className={styles.state}>
        <span aria-hidden="true" className={styles.stateIcon}>...</span>
        <div>
          <p className={styles.eyebrow}>Loading</p>
          <h2>Preparing employee profile</h2>
          <p>The business, branch and tab permissions are being verified.</p>
        </div>
      </section>
    </main>
  );
}

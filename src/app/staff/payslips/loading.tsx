import {
  StaffV2PageHeader,
  StaffV2SectionLabel,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-payslips-v2.module.css";

export default function StaffPayslipsLoading() {
  return (
    <section
      className={`${staffV2Styles.scope} ${styles.payslips}`}
      aria-busy="true"
      aria-label="Loading payslips"
    >
      <StaffV2PageHeader meta="Your published pay records." title="Payslips" />
      <section aria-labelledby="staff-published-payslips-loading-heading" className={styles.section}>
        <StaffV2SectionLabel id="staff-published-payslips-loading-heading">
          Published payslips
        </StaffV2SectionLabel>
        <div aria-hidden="true" className={styles.loadingGroup}>
          {[0, 1, 2].map((row) => (
            <div className={styles.loadingRow} key={row}>
              <span className={styles.loadingCopy}>
                <span className={styles.loadingLine} />
                <span className={styles.loadingMeta} />
              </span>
              <span className={styles.loadingAmount}>
                <span className={styles.loadingMeta} />
                <span className={styles.loadingMoney} />
              </span>
              <span className={styles.loadingGlyph} />
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

import Link from "next/link";
import styles from "./hr-payroll-issue.module.css";

type IssueAction = {
  href: string;
  label: string;
};

type HrPayrollIssueProps = {
  title: string;
  whatHappened: string;
  impact: string;
  affected?: string;
  nextAction?: IssueAction;
  technicalCode?: string;
  tone?: "warning" | "error" | "info";
};

export function HrPayrollIssue({
  title,
  whatHappened,
  impact,
  affected,
  nextAction,
  technicalCode,
  tone = "warning",
}: HrPayrollIssueProps) {
  return (
    <section className={`${styles.issue} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      <span className={styles.icon} aria-hidden="true">!</span>
      <div className={styles.content}>
        <div className={styles.heading}>
          <h2>{title}</h2>
          {nextAction ? <Link href={nextAction.href}>{nextAction.label}</Link> : null}
        </div>
        <dl className={styles.details}>
          <div><dt>What happened</dt><dd>{whatHappened}</dd></div>
          <div><dt>Why it matters</dt><dd>{impact}</dd></div>
          {affected ? <div><dt>Affected</dt><dd>{affected}</dd></div> : null}
        </dl>
        {technicalCode ? (
          <details className={styles.technical}>
            <summary>Technical details</summary>
            <code>{technicalCode}</code>
          </details>
        ) : null}
      </div>
    </section>
  );
}

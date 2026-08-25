import type { loadEmployeeClaimsSection } from "@/lib/team/employee-profile-claims-read";
import styles from "./employee-profile-shell.module.css";

type Data = Awaited<ReturnType<typeof loadEmployeeClaimsSection>>;

export function EmployeeProfileClaims({ data }: { data: Data }) {
  return <div className={styles.sectionContent}>
    <section className={styles.sectionIntro}><div><h2>Claims</h2><p>This employee&apos;s submitted amounts, decisions and reimbursement status.</p></div></section>
    <section className={styles.metricGrid}>
      <Metric label="Recent claims" value={data.total} /><Metric label="Awaiting review" value={data.submitted} /><Metric label="Approved" value={data.approved} /><Metric label="Awaiting reimbursement" value={data.reimbursementPending} />
    </section>
    <section className={styles.profilePanel}><div className={styles.panelHeading}><div><h3>Recent claims</h3></div><span>{formatCount(data.recent.length, "claim")}</span></div>
      {data.recent.length ? <div className={styles.assignmentList}>{data.recent.map((claim) => <article key={claim.id}><div><strong>Claim {claim.claimNumber}</strong><small>{claim.purpose}</small></div><div><span>RM {claim.submittedTotal} submitted</span><small>RM {claim.approvedTotal} approved</small></div><div><strong className={styles.statusBadge} data-status={claim.status.toLowerCase()}>{claim.status.replaceAll("_", " ")}</strong><small>{claim.reimbursementStatus?.replaceAll("_", " ") ?? "No reimbursement"}</small></div></article>)}</div> : <div className={styles.profileEmpty}><strong>No claims</strong><p>This employee has no claim history.</p></div>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

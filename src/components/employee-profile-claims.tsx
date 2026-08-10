import Link from "next/link";
import type { loadEmployeeClaimsSection } from "@/lib/team/employee-profile-claims-read";
import styles from "./employee-profile-shell.module.css";

type Data = Awaited<ReturnType<typeof loadEmployeeClaimsSection>>;

export function EmployeeProfileClaims({ data }: { data: Data }) {
  return <div className={styles.sectionContent}>
    <section className={styles.sectionIntro}><div><p className={styles.eyebrow}>Claims</p><h2>Claims & reimbursements</h2><p>Read-only Claim decisions and separate reimbursement status inside the authorized branch scope.</p></div><span className={styles.scopeBadge}>Read only</span></section>
    <section className={styles.metricGrid}>
      <Metric label="Recent Claims" value={data.total} /><Metric label="Awaiting review" value={data.submitted} /><Metric label="Approved" value={data.approved} /><Metric label="Reimbursement pending" value={data.reimbursementPending} />
    </section>
    <section className={styles.profilePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Recent history</p><h3>Claim and reimbursement status</h3></div><span>{data.recent.length} record(s)</span></div>
      {data.recent.length ? <div className={styles.assignmentList}>{data.recent.map((claim) => <article key={claim.id}><div><strong>Claim {claim.claimNumber}</strong><small>{claim.purpose}</small></div><div><span>RM {claim.submittedTotal} submitted</span><small>RM {claim.approvedTotal} approved</small></div><div><strong className={styles.statusBadge} data-status={claim.status.toLowerCase()}>{claim.status.replaceAll("_", " ")}</strong><small>{claim.reimbursementStatus?.replaceAll("_", " ") ?? "No reimbursement"}</small></div></article>)}</div> : <div className={styles.profileEmpty}><strong>No Claims</strong><p>This employee has no Claim history in the authorized scope.</p></div>}
      <Link className={styles.inlineLink} href="/team/claims">Open Claims Management</Link>
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong><small>Authorized scope</small></article>;
}

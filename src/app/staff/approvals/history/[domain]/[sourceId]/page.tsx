import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import {
  StaffV2AttachmentRow,
  StaffV2DetailSection,
  StaffV2PageHeader,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffApprovalHistoryDetail, type StaffApprovalHistoryDomain } from "@/lib/staff-pwa/approval-history";

export const metadata: Metadata = { title: "Approval decision" };
export const dynamic = "force-dynamic";

export default async function StaffApprovalHistoryDetailPage({ params }: { params: Promise<{ domain: string; sourceId: string }> }) {
  const route = await params;
  const value = route.domain.toUpperCase();
  const domain = ["LEAVE", "CLAIMS", "ATTENDANCE", "OT"].includes(value) ? value as StaffApprovalHistoryDomain : null;
  if (!domain) notFound();
  const auth = await requireEmployeeSelfServiceAuthContext();
  const detail = await getStaffApprovalHistoryDetail({ auth, domain, sourceId: decodeURIComponent(route.sourceId) });
  if (!detail) notFound();
  const facts = detail.facts.filter((fact) => fact.label !== "Request");

  return (
    <section className={`${staffV2Styles.scope} ${styles.detailPage}`}>
      <Link className={styles.backLink} href="/staff/approvals?view=history">← My History</Link>
      <StaffV2PageHeader title={detail.title} meta={`${detail.employeeName} · ${detail.branchName}`} />
      <StaffV2StatusBadge tone={decisionTone(detail.decision)}>{decisionLabel(detail.decision)}</StaffV2StatusBadge>
      <section className={styles.detailSurface}>
        <StaffV2DetailSection title="Decision">
          <div className={styles.decisionSummary}>
            <small>Your decision</small>
            <strong>{decisionLabel(detail.decision)}</strong>
            {detail.decisionDetail ? <span>{detail.decisionDetail}</span> : null}
            <time dateTime={detail.reviewedAt.toISOString()}>Decided {formatDateTime(detail.reviewedAt)}</time>
            {detail.reviewNote ? <p>{detail.reviewNote}</p> : null}
          </div>
        </StaffV2DetailSection>
        <StaffV2DetailSection title="Request">
          <dl className={styles.detailFacts}>
            <Fact label="Employee" value={detail.employeeName} />
            <Fact label="Workplace" value={detail.branchName} />
            <Fact label="Request" value={detail.summary} stacked />
            {facts.map((fact, index) => <Fact label={fact.label} value={fact.value} stacked={fact.label === "Reason"} key={`${fact.label}-${index}`} />)}
          </dl>
        </StaffV2DetailSection>
        {detail.leaveDocumentIds.length ? (
          <StaffV2DetailSection title="Supporting documents">
            <div className={styles.attachmentList}>
              {detail.leaveDocumentIds.map((document) => (
                <StaffV2AttachmentRow
                  action={<a href={`/api/staff-approvals/leave-documents/${document.id}`} target="_blank" rel="noreferrer" aria-label={`View supporting document ${document.fileName}`}>View</a>}
                  fileName={document.fileName}
                  key={document.id}
                  status="Supporting document"
                />
              ))}
            </div>
          </StaffV2DetailSection>
        ) : null}
        {detail.claimAttachmentIds.length ? (
          <StaffV2DetailSection title="Receipts">
            <div className={styles.attachmentList}>
              {detail.claimAttachmentIds.map((attachment) => (
                <StaffV2AttachmentRow
                  action={<a href={`/api/staff-approvals/claim-attachments/${attachment.id}`} target="_blank" rel="noreferrer" aria-label={`View receipt ${attachment.fileName || "attachment"}`}>View</a>}
                  fileName={attachment.fileName || "Receipt"}
                  key={attachment.id}
                  status="Receipt"
                />
              ))}
            </div>
          </StaffV2DetailSection>
        ) : null}
      </section>
      <p className={styles.boundary}>This is a read-only record of your decision. The request may have changed after another approval stage.</p>
    </section>
  );
}

function Fact({ label, value, stacked }: { label: string; value: string; stacked?: boolean }) {
  return <div className={stacked ? styles.stacked : ""}><dt>{label}</dt><dd>{value}</dd></div>;
}
function decisionLabel(decision: string) { return decision === "ADJUSTED" ? "Adjusted" : decision === "RETURNED" ? "Returned" : decision === "REJECTED" ? "Rejected" : "Approved"; }
function decisionTone(decision: string): "success" | "danger" | "warning" { return decision === "REJECTED" ? "danger" : decision === "ADJUSTED" || decision === "RETURNED" ? "warning" : "success"; }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value); }

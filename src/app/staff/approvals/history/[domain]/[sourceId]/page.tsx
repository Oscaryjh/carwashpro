import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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

  return <section className="staff-approval-detail staff-approval-history-detail">
    <Link className="staff-approval-back" href="/staff/approvals?view=history">← My History</Link>
    <header><div><p className="staff-kicker">{domainLabel(detail.domain)} · {detail.branchName}</p><h1>{detail.title}</h1><p>{detail.employeeName}</p></div><span className={`staff-approval-history-status ${detail.decision.toLowerCase()}`}>{decisionLabel(detail.decision)}</span></header>
    <section className="staff-approval-decision-summary"><small>YOUR DECISION</small><strong>{decisionLabel(detail.decision)}</strong>{detail.decisionDetail ? <span>{detail.decisionDetail}</span> : null}<time dateTime={detail.reviewedAt.toISOString()}>{formatDateTime(detail.reviewedAt)}</time>{detail.reviewNote ? <p>{detail.reviewNote}</p> : null}</section>
    <dl className="staff-approval-facts"><Fact label="Employee" value={detail.employeeName} /><Fact label="Workplace" value={detail.branchName} /><Fact label="Request" value={detail.summary} wide />{detail.facts.map((fact, index) => <Fact label={fact.label} value={fact.value} wide={fact.label === "Reason" || fact.label === "Request"} key={`${fact.label}-${index}`} />)}</dl>
    {detail.leaveDocumentIds.length ? <Evidence title="Supporting documents">{detail.leaveDocumentIds.map((document) => <a href={`/api/staff-approvals/leave-documents/${document.id}`} target="_blank" rel="noreferrer" key={document.id}>{document.fileName}</a>)}</Evidence> : null}
    {detail.claimAttachmentIds.length ? <Evidence title="Receipts">{detail.claimAttachmentIds.map((attachment) => <a href={`/api/staff-approvals/claim-attachments/${attachment.id}`} target="_blank" rel="noreferrer" key={attachment.id}>{attachment.fileName || "View receipt"}</a>)}</Evidence> : null}
    <p className="staff-approval-boundary">This is a read-only record of your decision. Current request status may have changed after another approval stage.</p>
  </section>;
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) { return <div className={wide ? "wide" : ""}><dt>{label}</dt><dd>{value}</dd></div>; }
function Evidence({ title, children }: { title: string; children: React.ReactNode }) { return <section className="staff-approval-evidence ready"><strong>{title}</strong>{children}</section>; }
function domainLabel(domain: string) { return domain === "CLAIMS" ? "Claims" : domain === "ATTENDANCE" ? "Attendance" : domain === "OT" ? "Overtime" : "Leave"; }
function decisionLabel(decision: string) { return decision === "ADJUSTED" ? "Adjusted" : decision === "RETURNED" ? "Returned" : decision === "REJECTED" ? "Rejected" : "Approved"; }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value); }

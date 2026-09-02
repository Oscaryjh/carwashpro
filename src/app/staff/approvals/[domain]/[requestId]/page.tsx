import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MobileApprovalForm } from "@/components/staff-pwa/mobile-approval-form";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffTeamApprovalDetail, type MobileApprovalDomain } from "@/lib/staff-pwa/team-approvals";
import { reviewMobileClaimAction, reviewMobileLeaveAction } from "../../actions";

export const metadata: Metadata = { title: "Review approval" };
export const dynamic = "force-dynamic";

export default async function StaffApprovalDetailPage({ params }: { params: Promise<{ domain: string; requestId: string }> }) {
  const route = await params;
  const domain = route.domain.toUpperCase() === "LEAVE" ? "LEAVE" : route.domain.toUpperCase() === "CLAIMS" ? "CLAIMS" : null;
  if (!domain) notFound();
  const auth = await requireEmployeeSelfServiceAuthContext();
  const detail = await getStaffTeamApprovalDetail(auth, domain as MobileApprovalDomain, route.requestId);
  if (!detail) notFound();

  if (detail.domain === "LEAVE") {
    const request = detail.request;
    const pending = request.status === "PENDING";
    return (
      <ApprovalShell title="Review Leave" employee={request.employee.fullName} branch={request.branch.name} status={request.status}>
        <dl className="staff-approval-facts">
          <Fact label="Leave type" value={request.policyName} />
          <Fact label="Dates" value={`${displayDate(request.startsOn)} – ${displayDate(request.endsOn)}`} />
          <Fact label="Duration" value={`${request.requestedDays} day(s) · ${humanize(request.leaveUnit)}`} />
          <Fact label="Reason" value={request.reason || "No reason provided"} wide />
          <Fact label="Current balance" value={request.currentBalance == null ? "Not tracked" : `${request.currentBalance} days`} />
          <Fact label="Balance after approval" value={request.resultingBalance == null ? "Not tracked" : `${request.resultingBalance} days`} />
        </dl>
        {request.supportingEvidenceRequired ? (
          <section className={`staff-approval-evidence ${request.supportingEvidenceStatus === "VERIFIED" ? "ready" : "warning"}`}>
            <strong>Supporting evidence · {humanize(request.supportingEvidenceStatus)}</strong>
            <span>{request.supportingDocuments.length ? `${request.supportingDocuments.length} document(s)` : "No document attached"}</span>
            {request.supportingDocuments.map((document) => <a href={`/api/staff-approvals/leave-documents/${document.id}`} target="_blank" rel="noreferrer" key={document.id}>{document.fileName}</a>)}
          </section>
        ) : null}
        {pending ? <MobileApprovalForm action={reviewMobileLeaveAction} idName="requestId" id={request.id} revision={request.revision} /> : <ReadOnly status={request.status} />}
      </ApprovalShell>
    );
  }

  const claim = detail.claim;
  const pending = claim.status === "SUBMITTED";
  return (
    <ApprovalShell title="Review Claim" employee={claim.membership.fullName} branch={claim.branch.name} status={claim.status}>
      <dl className="staff-approval-facts">
        <Fact label="Submitted amount" value={`RM ${Number(claim.submittedTotal).toFixed(2)}`} />
        <Fact label="Submitted" value={claim.submittedAt ? displayDateTime(claim.submittedAt) : "Not submitted"} />
        <Fact label="Purpose" value={claim.purpose} wide />
        <Fact label="Claim reference" value={claim.claimNumber} />
      </dl>
      <section className="staff-approval-lines">
        <h2>Claim items</h2>
        {claim.lines.map((line) => (
          <article key={line.id}>
            <div><strong>{line.categoryNameSnapshot}</strong><span>{line.description}</span></div>
            <b>RM {Number(line.submittedAmount).toFixed(2)}</b>
            {line.attachments?.map((attachment) => <a href={`/api/staff-approvals/claim-attachments/${attachment.id}`} target="_blank" rel="noreferrer" key={attachment.id}>View receipt</a>)}
          </article>
        ))}
      </section>
      <p className="staff-approval-boundary">Approval confirms reimbursement only. It does not mark the Claim paid or add it to Payroll.</p>
      {pending ? <MobileApprovalForm action={reviewMobileClaimAction} idName="claimId" id={claim.id} revision={claim.revision} /> : <ReadOnly status={claim.status} />}
    </ApprovalShell>
  );
}

function ApprovalShell({ title, employee, branch, status, children }: { title: string; employee: string; branch: string; status: string; children: React.ReactNode }) {
  return <section className="staff-approval-detail"><Link className="staff-approval-back" href="/staff/approvals">← Team Approvals</Link><header><div><p className="staff-kicker">{branch}</p><h1>{title}</h1><p>{employee}</p></div><span>{humanize(status)}</span></header>{children}</section>;
}
function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) { return <div className={wide ? "wide" : ""}><dt>{label}</dt><dd>{value}</dd></div>; }
function ReadOnly({ status }: { status: string }) { return <div className="staff-alert success">This item is already {humanize(status)} and is now read-only.</div>; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function displayDate(value: string) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)); }
function displayDateTime(value: string) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)); }

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { MobileApprovalForm } from "@/components/staff-pwa/mobile-approval-form";
import {
  StaffV2AttachmentRow,
  StaffV2DetailSection,
  StaffV2PageHeader,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
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
      <ApprovalShell title={request.policyName} employee={request.employee.fullName} branch={request.branch.name} pending={pending} status={request.status}>
        <section className={styles.detailSurface}>
          <StaffV2DetailSection title="Request">
            <dl className={styles.detailFacts}>
              <Fact label="Employee" value={request.employee.fullName} />
              <Fact label="Leave type" value={request.policyName} />
              <Fact label="Dates" value={`${displayDate(request.startsOn)} – ${displayDate(request.endsOn)}`} />
              <Fact label="Duration" value={`${request.requestedDays} day${Number(request.requestedDays) === 1 ? "" : "s"} · ${humanize(request.leaveUnit)}`} />
              <Fact label="Reason" value={request.reason || "No reason provided"} stacked />
            </dl>
          </StaffV2DetailSection>
          <StaffV2DetailSection title="Balance">
            <dl className={styles.detailFacts}>
              <Fact label="Current" value={request.currentBalance == null ? "Not tracked" : `${request.currentBalance} days`} />
              <Fact label="After approval" value={request.resultingBalance == null ? "Not tracked" : `${request.resultingBalance} days`} />
            </dl>
          </StaffV2DetailSection>
          {request.supportingEvidenceRequired ? (
            <StaffV2DetailSection title="Supporting documents">
              <p className={styles.boundary}>Leave approval and document verification are separate decisions.</p>
              <div className={styles.attachmentList}>
                {request.supportingDocuments.length ? request.supportingDocuments.map((document) => (
                  <StaffV2AttachmentRow
                    action={<a href={`/api/staff-approvals/leave-documents/${document.id}`} target="_blank" rel="noreferrer" aria-label={`View supporting document ${document.fileName}`}>View</a>}
                    fileName={document.fileName}
                    key={document.id}
                    status={humanize(request.supportingEvidenceStatus)}
                  />
                )) : <p className={styles.boundary}>No document attached.</p>}
              </div>
            </StaffV2DetailSection>
          ) : null}
        </section>
        {pending ? <MobileApprovalForm action={reviewMobileLeaveAction} idName="requestId" id={request.id} revision={request.revision} /> : <ReadOnly status={request.status} />}
      </ApprovalShell>
    );
  }

  const claim = detail.claim;
  const pending = claim.status === "SUBMITTED";
  return (
    <ApprovalShell title="Claim review" employee={claim.membership.fullName} branch={claim.branch.name} pending={pending} status={claim.status}>
      <section className={styles.detailSurface}>
        <StaffV2DetailSection title="Request">
          <dl className={styles.detailFacts}>
            <Fact label="Employee" value={claim.membership.fullName} />
            <Fact label="Amount" value={`RM ${Number(claim.submittedTotal).toFixed(2)}`} />
            <Fact label="Submitted" value={claim.submittedAt ? displayDateTime(claim.submittedAt) : "Not submitted"} />
            <Fact label="Purpose" value={claim.purpose} stacked />
            <Fact label="Reference" value={claim.claimNumber} />
          </dl>
        </StaffV2DetailSection>
        <StaffV2DetailSection title="Claim items">
          <div className={styles.attachmentList}>
            {claim.lines.map((line) => (
              <div className={styles.requestCopy} key={line.id}>
                <small>{line.categoryNameSnapshot}</small>
                <p>{line.description}</p>
                <strong>RM {Number(line.submittedAmount).toFixed(2)}</strong>
                {line.attachments?.map((attachment) => (
                  <StaffV2AttachmentRow
                    action={<a href={`/api/staff-approvals/claim-attachments/${attachment.id}`} target="_blank" rel="noreferrer" aria-label={`View receipt ${attachment.sanitizedFileName || "attachment"}`}>View</a>}
                    fileName={attachment.sanitizedFileName || "Receipt"}
                    key={attachment.id}
                    status="Receipt"
                  />
                ))}
              </div>
            ))}
          </div>
        </StaffV2DetailSection>
        <StaffV2DetailSection title="Approval boundary">
          <p className={styles.boundary}>Approval confirms the claim decision only. It does not mark the claim paid or add it to Payroll.</p>
        </StaffV2DetailSection>
      </section>
      {pending ? <MobileApprovalForm action={reviewMobileClaimAction} idName="claimId" id={claim.id} revision={claim.revision} /> : <ReadOnly status={claim.status} />}
    </ApprovalShell>
  );
}

function ApprovalShell({ title, employee, branch, pending, status, children }: {
  title: string;
  employee: string;
  branch: string;
  pending: boolean;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${staffV2Styles.scope} ${styles.detailPage} ${pending ? styles.detailPageWithActions : ""}`}>
      <Link className={styles.backLink} href="/staff/approvals">← Approvals</Link>
      <StaffV2PageHeader title={title} meta={`${employee} · ${branch}`} />
      {!pending ? <StaffV2StatusBadge tone={status === "REJECTED" ? "danger" : "success"}>{humanize(status)}</StaffV2StatusBadge> : null}
      {children}
    </section>
  );
}

function Fact({ label, value, stacked }: { label: string; value: string; stacked?: boolean }) {
  return <div className={stacked ? styles.stacked : ""}><dt>{label}</dt><dd>{value}</dd></div>;
}
function ReadOnly({ status }: { status: string }) {
  return <div className={`${styles.alert} ${status === "REJECTED" ? styles.alertDanger : styles.alertSuccess}`}>This request is {humanize(status).toLowerCase()} and read-only.</div>;
}
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function displayDate(value: string) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)); }
function displayDateTime(value: string) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)); }

"use client";

import { useFormStatus } from "react-dom";
import { StaffApprovalSheet } from "./staff-approval-sheet";
import styles from "./staff-approval-center-v2.module.css";
import { StaffV2StickyActionBar } from "./staff-v2-primitives";

export function MobileOvertimeApprovalForm({
  action,
  finalResultId,
  expectedRevision,
  month,
  potentialMinutes,
}: {
  action: (formData: FormData) => void | Promise<void>;
  finalResultId: string;
  expectedRevision: number;
  month: string;
  potentialMinutes: number;
}) {
  return (
    <StaffV2StickyActionBar aboveNavigation>
      <div className={`${styles.actionBarGrid} ${styles.actionBarGridThree}`} aria-label="Overtime decisions">
        <form action={action}>
          <DecisionFields finalResultId={finalResultId} expectedRevision={expectedRevision} month={month} />
          <OvertimeSubmit className={styles.primaryButton} decision="APPROVE">Approve {durationLabel(potentialMinutes)}</OvertimeSubmit>
        </form>
        <StaffApprovalSheet title="Adjust overtime" description={`Choose approved time up to ${durationLabel(potentialMinutes)} and add a reason.`} trigger="Adjust">
          <form action={action}>
            <DecisionFields finalResultId={finalResultId} expectedRevision={expectedRevision} month={month} />
            <div className={styles.durationGrid}>
              <label><span>Hours</span><input defaultValue="0" inputMode="numeric" min="0" name="approvedHours" required type="number" /></label>
              <label><span>Minutes</span><input defaultValue="0" inputMode="numeric" max="59" min="0" name="approvedMinuteRemainder" required type="number" /></label>
            </div>
            <label><span>Reason</span><textarea maxLength={500} minLength={3} name="reason" placeholder="Explain the adjustment" required /></label>
            <OvertimeSubmit className={styles.secondaryButton} decision="ADJUST">Save adjustment</OvertimeSubmit>
          </form>
        </StaffApprovalSheet>
        <StaffApprovalSheet title="Reject overtime" description="Add a clear reason for the employee." tone="danger" trigger="Reject">
          <form action={action}>
            <DecisionFields finalResultId={finalResultId} expectedRevision={expectedRevision} month={month} />
            <label><span>Reason</span><textarea maxLength={500} minLength={3} name="reason" placeholder="Add a clear, helpful reason" required /></label>
            <OvertimeSubmit className={styles.dangerButton} decision="REJECT">Reject overtime</OvertimeSubmit>
          </form>
        </StaffApprovalSheet>
      </div>
    </StaffV2StickyActionBar>
  );
}

function DecisionFields({ finalResultId, expectedRevision, month }: { finalResultId: string; expectedRevision: number; month: string }) {
  return <><input name="finalResultId" type="hidden" value={finalResultId} /><input name="expectedRevision" type="hidden" value={expectedRevision} /><input name="month" type="hidden" value={month} /></>;
}

function OvertimeSubmit({ className, decision, children }: { className: string; decision: "APPROVE" | "ADJUST" | "REJECT"; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} name="decision" value={decision}>{pending ? "Saving…" : children}</button>;
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return `${hours} hr${hours === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`;
}

"use client";

import { useFormStatus } from "react-dom";
import { StaffApprovalSheet } from "./staff-approval-sheet";
import styles from "./staff-approval-center-v2.module.css";
import { StaffV2StickyActionBar } from "./staff-v2-primitives";

export function MobileApprovalForm({ action, idName, id, revision }: {
  action: (formData: FormData) => void | Promise<void>;
  idName: "requestId" | "claimId";
  id: string;
  revision: number;
}) {
  return (
    <StaffV2StickyActionBar aboveNavigation>
      <div className={styles.actionBarGrid} aria-label="Approval decision">
        <StaffApprovalSheet
          description="Add a clear reason so the employee understands the decision."
          title="Reject request"
          tone="danger"
          trigger="Reject"
        >
          <form action={action}>
            <DecisionFields idName={idName} id={id} revision={revision} />
            <label>
              <span>Reason</span>
              <textarea maxLength={500} minLength={3} name="reason" placeholder="Add a clear, helpful reason" required rows={4} />
            </label>
            <SubmitButton decision="REJECTED" secondary>Reject request</SubmitButton>
          </form>
        </StaffApprovalSheet>
        <form action={action}>
          <DecisionFields idName={idName} id={id} revision={revision} />
          <SubmitButton decision="APPROVED">Approve</SubmitButton>
        </form>
      </div>
    </StaffV2StickyActionBar>
  );
}

function DecisionFields({ idName, id, revision }: { idName: "requestId" | "claimId"; id: string; revision: number }) {
  return <><input type="hidden" name={idName} value={id} /><input type="hidden" name="expectedRevision" value={revision} /></>;
}

function SubmitButton({ decision, secondary, children }: {
  decision: "APPROVED" | "REJECTED";
  secondary?: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={secondary ? styles.dangerButton : styles.primaryButton} disabled={pending} name="decision" value={decision}>
      {pending ? "Saving…" : children}
    </button>
  );
}

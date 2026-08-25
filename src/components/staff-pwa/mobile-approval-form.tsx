"use client";

import { useFormStatus } from "react-dom";

export function MobileApprovalForm({
  action,
  idName,
  id,
  revision,
}: {
  action: (formData: FormData) => void | Promise<void>;
  idName: "requestId" | "claimId";
  id: string;
  revision: number;
}) {
  return (
    <form action={action} className="staff-approval-decision-form">
      <input type="hidden" name={idName} value={id} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <label>
        <span>Reason for rejection (required when rejecting)</span>
        <textarea name="reason" rows={3} placeholder="Add a short reason if you reject this request" />
      </label>
      <div className="staff-approval-actions">
        <SubmitButton decision="REJECTED" secondary>Reject</SubmitButton>
        <SubmitButton decision="APPROVED">Approve</SubmitButton>
      </div>
    </form>
  );
}

function SubmitButton({ decision, secondary, children }: { decision: "APPROVED" | "REJECTED"; secondary?: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className={secondary ? "staff-approval-reject" : "staff-approval-approve"} disabled={pending} name="decision" value={decision}>
      {pending ? "Saving…" : children}
    </button>
  );
}

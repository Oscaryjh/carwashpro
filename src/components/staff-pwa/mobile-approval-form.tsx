"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export function MobileApprovalForm({ action, idName, id, revision }: { action: (formData: FormData) => void | Promise<void>; idName: "requestId" | "claimId"; id: string; revision: number }) {
  const [rejecting, setRejecting] = useState(false);
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!rejecting) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setRejecting(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [rejecting]);

  return <section className="staff-approval-decision-form" aria-label="Approval decision">
    <p>Review the request details before making your decision.</p>
    <div className="staff-approval-actions">
      <button className="staff-approval-reject" onClick={() => setRejecting(true)} type="button">Reject</button>
      <form action={action}><DecisionFields idName={idName} id={id} revision={revision} /><SubmitButton decision="APPROVED">Approve</SubmitButton></form>
    </div>
    {rejecting ? <div className="staff-approval-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setRejecting(false); }}>
      <section aria-labelledby={titleId} aria-modal="true" className="staff-approval-sheet" role="dialog">
        <div className="staff-approval-sheet-handle" aria-hidden="true" />
        <header><div><p className="staff-kicker">DECISION</p><h2 id={titleId}>Reject request?</h2></div><button aria-label="Close rejection form" onClick={() => setRejecting(false)} ref={closeButton} type="button">×</button></header>
        <p>Tell the employee what needs attention. A reason is required.</p>
        <form action={action}><DecisionFields idName={idName} id={id} revision={revision} /><label><span>Reason for rejection</span><textarea autoFocus maxLength={500} minLength={3} name="reason" placeholder="Add a clear, helpful reason" required rows={4} /></label><SubmitButton decision="REJECTED" secondary>Reject request</SubmitButton></form>
      </section>
    </div> : null}
  </section>;
}

function DecisionFields({ idName, id, revision }: { idName: "requestId" | "claimId"; id: string; revision: number }) { return <><input type="hidden" name={idName} value={id} /><input type="hidden" name="expectedRevision" value={revision} /></>; }
function SubmitButton({ decision, secondary, children }: { decision: "APPROVED" | "REJECTED"; secondary?: boolean; children: React.ReactNode }) { const { pending } = useFormStatus(); return <button className={secondary ? "staff-approval-reject" : "staff-approval-approve"} disabled={pending} name="decision" value={decision}>{pending ? "Saving…" : children}</button>; }

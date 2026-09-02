"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closeDailySnapshotAction,
  manualClosingWhatsAppSendAction,
  type CloseDailySnapshotState,
} from "@/app/(business)/closing/actions";
import { formatMoneyFromCents } from "@/lib/daily-closing/format";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";

const initialCloseDailySnapshotState: CloseDailySnapshotState = {
  message: "",
  status: "idle",
};

type ClosedSnapshot = {
  actualCashCents: number;
  cashDifferenceCents: number;
  closedAtLabel: string;
  closedByName: string;
  closingNote: string | null;
  expectedCashCents: number;
  whatsappSends: ClosingWhatsAppSendView[];
};

type ClosingWhatsAppSendView = {
  completedAtLabel: string | null;
  errorMessage: string | null;
  id: string;
  phone: string;
  reason: string | null;
  recipientLabel: string;
  recipientRole: string | null;
  requestedAtLabel: string;
  requestedByName: string | null;
  sendType: string;
  status: string;
  trigger: string;
};

export function DailyClosingSnapshotPanel({
  branchId,
  branchName,
  businessDate,
  expectedCashCents,
  openShiftCount,
  snapshot,
  lateActivity,
}: {
  branchId: string;
  branchName: string;
  businessDate: string;
  expectedCashCents: number;
  openShiftCount: number;
  snapshot: ClosedSnapshot | null;
  lateActivity: {
    count: number;
    firstAtLabel: string;
    latestAtLabel: string;
    netCashMovementCents: number;
  } | null;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [actualCash, setActualCash] = useState(
    (expectedCashCents / 100).toFixed(2),
  );
  const [closingNote, setClosingNote] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [state, action, pending] = useActionState(
    closeDailySnapshotAction,
    initialCloseDailySnapshotState,
  );
  const { operationId, rotateOperationId } = useFinancialOperationId("daily-closing");
  const actualCashValidation = useMemo(() => {
    const value = Number(actualCash);
    const valid = Number.isFinite(value) && value >= 0 && value <= 21_474_836.47 &&
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
    return { cents: valid ? Math.round(value * 100) : 0, valid };
  }, [actualCash]);
  const actualCashCents = actualCashValidation.cents;
  const differenceCents = actualCashCents - expectedCashCents;
  const closingBlocked = openShiftCount > 0;
  const reasonRequired = differenceCents !== 0;
  const reasonMissing = reasonRequired && !closingNote.trim();

  useEffect(() => {
    if (state.status !== "success") return;
    rotateOperationId();
    setModalOpen(false);
    router.refresh();
  }, [rotateOperationId, router, state.status]);

  useEffect(() => {
    if (!modalOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const trigger = triggerRef.current;
    initialFocusRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        setModalOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      (previouslyFocused ?? trigger)?.focus();
    };
  }, [modalOpen, pending]);

  if (snapshot) {
    return (
      <section className="panel daily-closing-snapshot-panel is-closed">
        <div className="daily-closing-snapshot-heading">
          <div>
            <span className="daily-closing-eyebrow">FROZEN DAILY CLOSING</span>
            <h2>Daily Closing</h2>
            <p>
              Closed by {snapshot.closedByName} on{" "}
              {snapshot.closedAtLabel}.
            </p>
          </div>
          <span className="status">Closed</span>
        </div>
        <div className="daily-closing-cash-grid">
          <CashMetric
            label="Expected Net Cash Movement"
            value={formatMoneyFromCents(snapshot.expectedCashCents)}
          />
          <CashMetric
            label="Actual Net Cash Movement"
            value={formatMoneyFromCents(snapshot.actualCashCents)}
          />
          <CashMetric
            label="Difference"
            value={formatSignedMoney(snapshot.cashDifferenceCents)}
            tone={differenceTone(snapshot.cashDifferenceCents)}
          />
        </div>
        <p className="daily-closing-cash-helper">Daily cash movement excludes opening floats.</p>
        {lateActivity ? (
          <div className="warning daily-closing-late-activity" role="alert">
            <strong>Activity recorded after Daily Closing</strong>
            <p>
              {lateActivity.count} {lateActivity.count === 1 ? "record was" : "records were"} added after this closing was frozen.
              {" "}{formatSignedMoney(lateActivity.netCashMovementCents)} net cash movement is not included in the closed snapshot.
            </p>
            <small>{lateActivity.firstAtLabel} to {lateActivity.latestAtLabel}</small>
          </div>
        ) : null}
        {snapshot.closingNote ? (
          <div className="daily-closing-note-row">
            <strong>Closing note</strong>
            <span>{snapshot.closingNote}</span>
          </div>
        ) : null}
        <ClosingWhatsAppStatus sends={snapshot.whatsappSends} />
        <div className="daily-closing-snapshot-actions">
          <Link href="/closing/history" className="button secondary">
            View closing history
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="panel daily-closing-snapshot-panel">
        <div className="daily-closing-snapshot-heading">
          <div>
            <span className="daily-closing-eyebrow">DAILY CLOSE</span>
            <h2>Complete daily closing</h2>
            <p>
              Count the cash for {branchName}, then lock the final report and
              WhatsApp summary.
            </p>
          </div>
          <span className="status neutral">Not closed</span>
        </div>
        {closingBlocked ? (
          <div className="warning daily-closing-action-message" role="alert">
            <strong>Daily Closing not ready</strong>
            <p>
              {openShiftCount} cashier {openShiftCount === 1 ? "shift is" : "shifts are"} still open.
              Close all shifts for this branch first.
            </p>
          </div>
        ) : null}
        <div className="daily-closing-cash-entry">
          <CashMetric
            label="Expected Net Cash Movement"
            value={formatMoneyFromCents(expectedCashCents)}
          />
          <label>
            <span>Actual Net Cash Movement</span>
            <input
              inputMode="decimal"
              min="0"
              max="21474836.47"
              onChange={(event) => setActualCash(event.target.value)}
              disabled={closingBlocked}
              step="0.01"
              type="number"
              value={actualCash}
            />
          </label>
          <CashMetric
            label="Difference"
            value={formatSignedMoney(differenceCents)}
            tone={differenceTone(differenceCents)}
          />
        </div>
        <label className="daily-closing-note-input">
          <span>{reasonRequired ? "Difference reason" : "Closing note (optional)"}</span>
          <textarea
            maxLength={1000}
            onChange={(event) => setClosingNote(event.target.value)}
            disabled={closingBlocked}
            placeholder="Add a reason for any cash difference or an operational note."
            rows={2}
            required={reasonRequired}
            aria-describedby="daily-closing-reason-help"
            value={closingNote}
          />
        </label>
        <small id="daily-closing-reason-help" className={reasonMissing ? "error-text" : "field-help"}>
          {reasonRequired ? "Explain every non-zero cash difference before confirming." : "Add an operational note only when useful."}
        </small>
        {state.status === "error" ? (
          <p className="error daily-closing-action-message">{state.message}</p>
        ) : null}
        <div className="daily-closing-snapshot-actions">
          <Link href="/closing/history" className="button secondary">
            Closing history
          </Link>
          <button
            ref={triggerRef}
            disabled={closingBlocked || !actualCashValidation.valid || reasonMissing}
            type="button"
            onClick={() => setModalOpen(true)}
          >
            Complete daily closing
          </button>
        </div>
      </section>

      {modalOpen ? (
        <div
          className="daily-closing-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) {
              setModalOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="daily-closing-confirm-title"
            aria-modal="true"
            className="daily-closing-confirm-modal"
            role="dialog"
            ref={dialogRef}
          >
            <div className="daily-closing-confirm-header">
              <div>
                <span className="daily-closing-eyebrow">COMPLETE DAILY CLOSING</span>
                <h2 id="daily-closing-confirm-title">Lock {businessDate}</h2>
              </div>
              <button
                ref={initialFocusRef}
                aria-label="Close"
                className="icon-button"
                disabled={pending}
                onClick={() => setModalOpen(false)}
                type="button"
              >
                X
              </button>
            </div>
            <p>
              This freezes the report for {branchName}. It cannot be edited,
              reopened or recalculated later.
            </p>
            <div className="daily-closing-confirm-values">
              <CashMetric
                label="Expected Net Cash Movement"
                value={formatMoneyFromCents(expectedCashCents)}
              />
              <CashMetric
                label="Actual Net Cash Movement"
                value={formatMoneyFromCents(actualCashCents)}
              />
              <CashMetric
                label="Difference"
                value={formatSignedMoney(differenceCents)}
                tone={differenceTone(differenceCents)}
              />
            </div>
            <form action={action}>
              <input type="hidden" name="operationId" value={operationId} />
              <input type="hidden" name="branchId" value={branchId} />
              <input type="hidden" name="businessDate" value={businessDate} />
              <input type="hidden" name="actualCash" value={actualCash} />
              <input type="hidden" name="closingNote" value={closingNote} />
              <div className="daily-closing-confirm-actions">
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() => setModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button disabled={pending} type="submit">
                  {pending ? "Closing..." : "Complete and lock report"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ClosingWhatsAppStatus({ sends }: { sends: ClosingWhatsAppSendView[] }) {
  if (!sends.length) {
    return (
      <details className="daily-closing-whatsapp-status empty">
        <summary><strong>WhatsApp Closing Report</strong><span>Not configured</span></summary>
        <p>No closing WhatsApp send records for this snapshot.</p>
      </details>
    );
  }

  return (
    <details className="daily-closing-whatsapp-status">
      <summary className="daily-closing-whatsapp-status-header">
        <div>
          <strong>WhatsApp automation</strong>
          <span>Frozen report and resend activity.</span>
        </div>
        <span>{sends.length} records</span>
      </summary>
      <div className="daily-closing-whatsapp-send-list">
        {sends.map((send) => (
          <div key={send.id} className="daily-closing-whatsapp-send-row">
            <div>
              <strong>{formatSendType(send.sendType)}</strong>
              <span>
                {send.recipientLabel}
                {send.recipientRole ? ` - ${formatRole(send.recipientRole)}` : ""} -{" "}
                {send.phone}
              </span>
              <small>
                {formatTrigger(send.trigger)} - {send.requestedAtLabel}
                {send.requestedByName ? ` - by ${send.requestedByName}` : ""}
              </small>
              {send.reason ? <small>Reason: {send.reason}</small> : null}
              {send.errorMessage ? <small className="error-text">{send.errorMessage}</small> : null}
            </div>
            <div className="daily-closing-whatsapp-send-actions">
              <span className={`status ${send.status.toLowerCase()}`}>
                {formatStatus(send.status)}
              </span>
              {send.completedAtLabel ? <small>{send.completedAtLabel}</small> : null}
              {send.status === "FAILED" ? (
                <ManualSendForm send={send} trigger="MANUAL_RETRY" />
              ) : isResendable(send.status) ? (
                <ManualSendForm send={send} trigger="MANUAL_RESEND" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function ManualSendForm({
  send,
  trigger,
}: {
  send: ClosingWhatsAppSendView;
  trigger: "MANUAL_RETRY" | "MANUAL_RESEND";
}) {
  return (
    <form action={manualClosingWhatsAppSendAction} className="daily-closing-whatsapp-manual-form">
      <input type="hidden" name="attemptId" value={send.id} />
      <input type="hidden" name="trigger" value={trigger} />
      <input
        aria-label={`${trigger === "MANUAL_RETRY" ? "Retry" : "Resend"} reason`}
        name="reason"
        placeholder="Reason"
      />
      <button className="secondary compact" type="submit">
        {trigger === "MANUAL_RETRY" ? "Retry" : "Resend"}
      </button>
    </form>
  );
}

function isResendable(status: string) {
  return ["SENT_TO_SERVER", "DELIVERED", "READ"].includes(status);
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSendType(sendType: string) {
  return sendType === "UNCLOSED_REMINDER"
    ? "Unclosed reminder"
    : "Closing report";
}

function formatTrigger(trigger: string) {
  if (trigger === "AUTO_REMINDER") return "Auto reminder";
  if (trigger === "AUTO_CLOSING") return "Auto closing";
  if (trigger === "MANUAL_RETRY") return "Manual retry";
  return "Manual resend";
}

function formatRole(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function CashMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "balanced" | "over" | "short";
  value: string;
}) {
  return (
    <div className={`daily-closing-cash-metric${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function differenceTone(value: number) {
  if (value === 0) return "balanced" as const;
  return value < 0 ? ("short" as const) : ("over" as const);
}

function formatSignedMoney(value: number) {
  if (value === 0) return formatMoneyFromCents(0);
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatMoneyFromCents(Math.abs(value))}`;
}

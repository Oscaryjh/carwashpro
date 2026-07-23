"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closeDailySnapshotAction,
  type CloseDailySnapshotState,
} from "@/app/(business)/closing/actions";
import { formatMoneyFromCents } from "@/lib/daily-closing/format";

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
};

export function DailyClosingSnapshotPanel({
  branchId,
  branchName,
  businessDate,
  expectedCashCents,
  snapshot,
}: {
  branchId: string;
  branchName: string;
  businessDate: string;
  expectedCashCents: number;
  snapshot: ClosedSnapshot | null;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [actualCash, setActualCash] = useState(
    (expectedCashCents / 100).toFixed(2),
  );
  const [closingNote, setClosingNote] = useState("");
  const [state, action, pending] = useActionState(
    closeDailySnapshotAction,
    initialCloseDailySnapshotState,
  );
  const actualCashCents = useMemo(() => {
    const value = Number(actualCash);
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }, [actualCash]);
  const differenceCents = actualCashCents - expectedCashCents;

  useEffect(() => {
    if (state.status !== "success") return;
    setModalOpen(false);
    router.refresh();
  }, [router, state.status]);

  if (snapshot) {
    return (
      <section className="panel daily-closing-snapshot-panel is-closed">
        <div className="daily-closing-snapshot-heading">
          <div>
            <span className="daily-closing-eyebrow">FORMAL DAILY CLOSING</span>
            <h2>Business day closed</h2>
            <p>
              Frozen by {snapshot.closedByName} on {snapshot.closedAtLabel}.
            </p>
          </div>
          <span className="status">Closed</span>
        </div>
        <div className="daily-closing-cash-grid">
          <CashMetric
            label="Expected cash"
            value={formatMoneyFromCents(snapshot.expectedCashCents)}
          />
          <CashMetric
            label="Actual cash"
            value={formatMoneyFromCents(snapshot.actualCashCents)}
          />
          <CashMetric
            label="Difference"
            value={formatSignedMoney(snapshot.cashDifferenceCents)}
            tone={differenceTone(snapshot.cashDifferenceCents)}
          />
        </div>
        {snapshot.closingNote ? (
          <div className="daily-closing-note-row">
            <strong>Closing note</strong>
            <span>{snapshot.closingNote}</span>
          </div>
        ) : null}
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
            <span className="daily-closing-eyebrow">FORMAL DAILY CLOSING</span>
            <h2>Confirm and freeze this report</h2>
            <p>
              Enter the counted cash for {branchName}. Once confirmed, this
              business day becomes read-only.
            </p>
          </div>
          <span className="status neutral">Live</span>
        </div>
        <div className="daily-closing-cash-entry">
          <CashMetric
            label="Expected cash"
            value={formatMoneyFromCents(expectedCashCents)}
          />
          <label>
            <span>Actual cash counted</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => setActualCash(event.target.value)}
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
          <span>Closing note optional</span>
          <textarea
            maxLength={1000}
            onChange={(event) => setClosingNote(event.target.value)}
            placeholder="Add a reason for any cash difference or an operational note."
            rows={2}
            value={closingNote}
          />
        </label>
        {state.status === "error" ? (
          <p className="error daily-closing-action-message">{state.message}</p>
        ) : null}
        <div className="daily-closing-snapshot-actions">
          <Link href="/closing/history" className="button secondary">
            Closing history
          </Link>
          <button type="button" onClick={() => setModalOpen(true)}>
            Confirm daily closing
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
          >
            <div className="daily-closing-confirm-header">
              <div>
                <span className="daily-closing-eyebrow">FINAL CONFIRMATION</span>
                <h2 id="daily-closing-confirm-title">Close {businessDate}</h2>
              </div>
              <button
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
                label="Expected cash"
                value={formatMoneyFromCents(expectedCashCents)}
              />
              <CashMetric
                label="Actual cash"
                value={formatMoneyFromCents(actualCashCents)}
              />
              <CashMetric
                label="Difference"
                value={formatSignedMoney(differenceCents)}
                tone={differenceTone(differenceCents)}
              />
            </div>
            <form action={action}>
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
                  {pending ? "Closing..." : "Confirm and freeze"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
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

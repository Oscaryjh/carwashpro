"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { saveCashierOperationsAction, type CashierOperationsState } from "@/app/(business)/business/settings/cashier-operations-actions";

const initialState: CashierOperationsState = { status: "idle", message: "" };
const openShiftError = "Close all open cashier shifts before disabling cashier shifts.";

export function CashierOperationsSettings({ enabled }: { enabled: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const previousEnabled = useRef(enabled);
  const [baseline, setBaseline] = useState(enabled);
  const [selection, setSelection] = useState(enabled);
  const [feedback, setFeedback] = useState(initialState);
  const [, action, pending] = useActionState(async (previous: CashierOperationsState, data: FormData) => {
    const result = await saveCashierOperationsAction(previous, data);
    if (result.status === "success") {
      setBaseline(data.get("cashierShiftsEnabled") === "true");
      setSelection(data.get("cashierShiftsEnabled") === "true");
      setFeedback(result.message === "Cashier operations unchanged." ? initialState : {
        status: "success", message: "Cashier operations updated.",
      });
    } else {
      setFeedback({
        ...result,
        message: result.message === openShiftError
          ? "End all open cashier shifts before turning Cashier shifts off."
          : result.message,
      });
    }
    return result;
  }, initialState);

  useEffect(() => {
    if (previousEnabled.current === enabled) return;
    previousEnabled.current = enabled;
    setBaseline(enabled);
    setSelection(enabled);
  }, [enabled]);

  useEffect(() => {
    const dialog = formRef.current?.closest("dialog");
    const discard = () => { setSelection(baseline); setFeedback(initialState); };
    dialog?.addEventListener("close", discard);
    return () => dialog?.removeEventListener("close", discard);
  }, [baseline]);

  useEffect(() => {
    if (feedback.status !== "success") return;
    const timer = window.setTimeout(() => setFeedback(initialState), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return (
    <form ref={formRef} className="cashier-operations-form" onSubmit={event => {
      event.preventDefault();
      if (pending || selection === baseline) return;
      setFeedback(initialState);
      const data = new FormData(event.currentTarget);
      startTransition(() => action(data));
    }}>
      <input type="hidden" name="cashierShiftsEnabled" value={String(selection)} />
      <div className="cashier-operations-control">
        <span>Cashier shifts</span>
        <button type="button" role="switch" aria-label="Cashier shifts"
          aria-checked={selection} aria-describedby="cashier-shifts-description"
          className="cashier-shifts-switch" disabled={pending}
          onClick={() => { setSelection(!selection); setFeedback(initialState); }}>
          <span>{selection ? "ON" : "OFF"}</span>
          <span className="cashier-shifts-thumb" aria-hidden="true" />
        </button>
      </div>
      <div id="cashier-shifts-description" className="cashier-operations-description">
        <strong>{selection ? "Track cashier shifts" : "Recommended for most businesses"}</strong>
        <p>{selection
          ? "Requires staff to start a shift, enter opening cash and reconcile the cash drawer when ending the shift."
          : "Use Cashier directly without starting or ending a shift."}</p>
      </div>
      {feedback.message ? <p role={feedback.status === "error" ? "alert" : "status"}
        className="cashier-operations-feedback">{feedback.message}</p> : null}
      <div className="cashier-operations-actions">
        <button type="button" className="secondary-button"
          onClick={() => formRef.current?.closest("dialog")?.close()}>Cancel</button>
        <button type="submit" className="primary-button" disabled={pending || selection === baseline}>
          {pending ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

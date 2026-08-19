"use client";

import { useMemo, useState } from "react";
import { markExpensePaidAction } from "@/app/(business)/expenses/actions";
import { EXPENSE_PAYMENT_ACCOUNTS, expensePaymentAccountValue, resolveExpensePaymentAccount } from "@/lib/expense/payment-account";
import styles from "@/app/(business)/expenses/expense.module.css";

type DrawerShift = { availableCash: string; cashierName: string; id: string; isCurrentUser: boolean; startedAt: string };

export function ExpensePaymentForm(props: { expenseId: string; expectedRevision: number; openDrawerShifts: DrawerShift[]; operationKey: string; outstanding: string }) {
  const [amount, setAmount] = useState(props.outstanding);
  const [method, setMethod] = useState("");
  const [source, setSource] = useState("");
  const [shiftId, setShiftId] = useState("");
  const automaticShift = automaticDrawerShift(props.openDrawerShifts);
  const effectiveShiftId = source === "POS_DRAWER" && automaticShift ? automaticShift.id : shiftId;
  const selectedShift = props.openDrawerShifts.find((shift) => shift.id === effectiveShiftId) ?? null;
  const drawerMath = useMemo(() => {
    if (source !== "POS_DRAWER" || !selectedShift) return null;
    const requested = Number(amount);
    const available = Number(selectedShift.availableCash);
    if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(available)) return null;
    return { available, remaining: available - requested, requested, shortfall: Math.max(0, requested - available) };
  }, [amount, selectedShift, source]);
  const drawerBlocked = source === "POS_DRAWER" && (!selectedShift || Boolean(drawerMath && drawerMath.shortfall > 0));

  function changePaymentAccount(value: string) {
    const account = resolveExpensePaymentAccount(value);
    setMethod(account?.paymentMethod ?? "");
    setSource(account?.paymentSource ?? "");
    if (account?.paymentSource !== "POS_DRAWER") setShiftId("");
  }

  return <form action={markExpensePaidAction} className={styles.form}>
    <input type="hidden" name="expenseId" value={props.expenseId} />
    <input type="hidden" name="expectedRevision" value={props.expectedRevision} />
    <input type="hidden" name="operationKey" value={props.operationKey} />
    <input type="hidden" name="paymentMethod" value={method} />
    <input type="hidden" name="paymentSource" value={source} />
    <label>Amount (MYR)<input name="amount" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    <label>Payment date<input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
    <label>Paid from / payment account
      <select required value={expensePaymentAccountValue(method, source)} onChange={(event) => changePaymentAccount(event.target.value)}><PaymentAccountOptions canUsePosDrawer={props.openDrawerShifts.length > 0} /></select>
      <small>Choose the account used. Tetamu records the matching payment method automatically; only POS drawer cash reduces Shift Closing expected cash.</small>
    </label>
    {source === "POS_DRAWER" ? automaticShift ? <AutomaticShift shift={automaticShift} /> : props.openDrawerShifts.length ? <label className={styles.full}>Which open POS shift?
      <select name="cashierShiftId" required value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="">Select open shift</option>{props.openDrawerShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.cashierName} · opened {formatTime(shift.startedAt)} · RM {shift.availableCash} available</option>)}</select>
      <small>More than one drawer is open. Choose the drawer that is paying this expense.</small>
    </label> : <p className={`${styles.full} ${styles.panelNote}`}>No open POS shift exists for this branch. Drawer cash cannot be selected until a shift is opened.</p> : null}
    {source === "POS_DRAWER" ? <section className={`${styles.full} ${styles.drawerBalanceCard} ${drawerBlocked ? styles.drawerBalanceBlocked : styles.drawerBalanceReady}`} aria-live="polite">
      {!selectedShift ? <><strong>Select an open POS shift</strong><span>The expense stays Unpaid until a valid drawer is selected.</span></> : drawerMath ? <><div><span>Drawer available</span><strong>RM {drawerMath.available.toFixed(2)}</strong></div><div><span>This payment</span><strong>RM {drawerMath.requested.toFixed(2)}</strong></div><div><span>{drawerMath.shortfall > 0 ? "Short by" : "Remaining after payment"}</span><strong>RM {Math.abs(drawerMath.shortfall > 0 ? drawerMath.shortfall : drawerMath.remaining).toFixed(2)}</strong></div><p>{drawerMath.shortfall > 0 ? "Not enough drawer cash. This payment cannot be recorded; the expense remains Unpaid. Choose another funding source or enter a smaller payment." : "Enough expected cash is available. The server will verify the balance again when you submit."}</p></> : <><strong>Enter a valid payment amount</strong><span>The drawer balance will be checked before submission.</span></>}
    </section> : null}
    <label className={styles.full}>Reference<input name="paymentReference" maxLength={160} placeholder="Bank reference, DuitNow reference or receipt no." /></label>
    <button className={styles.full} disabled={drawerBlocked}>{drawerBlocked ? "POS drawer payment unavailable" : "Record payment"}</button>
  </form>;
}

function AutomaticShift({ shift }: { shift: DrawerShift }) {
  return <div className={`${styles.full} ${styles.automaticShift}`}>
    <input type="hidden" name="cashierShiftId" value={shift.id} />
    <div><span>Current POS shift</span><strong>{shift.cashierName}</strong></div>
    <div><span>Opened</span><strong>{formatTime(shift.startedAt)}</strong></div>
    <div><span>Available cash</span><strong>RM {shift.availableCash}</strong></div>
    <small>Selected automatically. Change the payment account if this expense was not paid from the drawer.</small>
  </div>;
}

function automaticDrawerShift(shifts: DrawerShift[]) {
  const currentUserShifts = shifts.filter((shift) => shift.isCurrentUser);
  if (currentUserShifts.length === 1) return currentUserShifts[0];
  return shifts.length === 1 ? shifts[0] : null;
}

function PaymentAccountOptions({ canUsePosDrawer }: { canUsePosDrawer: boolean }) {
  return <><option value="" disabled>Select payment account</option>{EXPENSE_PAYMENT_ACCOUNTS.map((option) => <option key={option.value} value={option.value} disabled={option.paymentSource === "POS_DRAWER" && !canUsePosDrawer}>{option.label}{option.paymentSource === "POS_DRAWER" && !canUsePosDrawer ? " · no open shift" : ""}</option>)}</>;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
}

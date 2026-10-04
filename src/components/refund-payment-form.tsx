"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  refundPaymentAction,
  refundCashierActivityAction,
  type RefundPaymentState,
} from "@/app/(business)/invoices/actions";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";
import type { PackagePurchaseRefundPresentation } from "@/lib/refunds/package-presentation";

type RefundPaymentFormProps = {
  cashierShiftsEnabled?: boolean;
  shiftId?: string | null;
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  originalMethod: string;
  refundableAmount: number;
  packagePurchaseRefund?: PackagePurchaseRefundPresentation | null;
  onSuccess?: () => void;
  stockLines?: Array<{
    id: string;
    name: string;
    remainingQuantity: number;
  }>;
};

type RefundFormState = RefundPaymentState & { completedOperationId?: string };
const initialState: RefundFormState = {
  status: "idle",
  message: "",
};

const refundMethods = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "DUITNOW", label: "DuitNow" },
  { value: "EWALLET", label: "E-wallet" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
] as const;

export function RefundPaymentForm({
  cashierShiftsEnabled,
  shiftId = null,
  invoiceId,
  invoiceNumber,
  paymentId,
  originalMethod,
  refundableAmount,
  packagePurchaseRefund,
  onSuccess,
  stockLines = [],
}: RefundPaymentFormProps) {
  const router = useRouter();
  const packageRefund = originalMethod === "PACKAGE";
  const availableRefundMethods = originalMethod === "FOREIGN_CURRENCY"
    ? [...refundMethods, { value: "FOREIGN_CURRENCY", label: "Original foreign currency" } as const]
    : originalMethod === "CRYPTO"
      ? [...refundMethods, { value: "CRYPTO", label: "Original crypto asset" } as const]
      : refundMethods;
  const defaultMethod = packageRefund
    ? "PACKAGE"
    : availableRefundMethods.some((method) => method.value === originalMethod)
      ? originalMethod
      : "CASH";
  const [method, setMethod] = useState(defaultMethod);
  const form = useRef<HTMLFormElement>(null);
  const submittedValues = useRef<[string, string][]>([]);
  const submitting = useRef(false);
  const completedOperation = useRef<string | null>(null);
  const [lockedValues, setLockedValues] = useState<[string, string][] | null>(null);
  const recoveryKey = `refund-request:${invoiceId}:${paymentId}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(recoveryKey);
    if (!saved) return;
    try {
      const entries: unknown = JSON.parse(saved);
      if (Array.isArray(entries) && entries.every(entry => Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === "string"))) {
        submittedValues.current = entries;
        setLockedValues(entries);
        setMethod(entries.find(([name]) => name === "method")?.[1] ?? defaultMethod);
      }
    } catch { /* Invalid browser recovery data is never submitted. */ }
  }, [recoveryKey, defaultMethod]);
  const [state, formAction, pending] = useActionState(
    async (previous: RefundFormState, data: FormData): Promise<RefundFormState> => {
      const request = new FormData();
      for (const [name, value] of submittedValues.current.length ? submittedValues.current : [...data.entries()]) request.append(name, value);
      try {
        const result = await refundPaymentAction(previous, request);
        if (result.status === "success") return { ...result, completedOperationId: String(request.get("operationId")) };
        if (result.canCorrect) {
          sessionStorage.removeItem(recoveryKey);
          setLockedValues(null);
        }
        return result;
      } catch (error) {
        if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
        return { status: "error", message: "Unable to confirm refund. Check refund status before retrying with this same request. Your entries and request ID are retained." };
      } finally {
        submitting.current = false;
      }
    },
    initialState,
  );
  const safeState = state ?? initialState;
  useLayoutEffect(() => {
    if ((!lockedValues && safeState.status !== "error") || !form.current) return;
    // A resolved error action also resets uncontrolled inputs in React.
    // Restore the submitted request, never the refundable-balance defaults.
    for (const element of form.current.elements) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
      if (!element.name || (element instanceof HTMLInputElement && ["hidden", "file"].includes(element.type))) continue;
      const values = submittedValues.current.filter(([name]) => name === element.name).map(([, value]) => value);
      if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) element.checked = values.includes(element.value);
      else if (values.length) element.value = values[0];
    }
  }, [safeState, lockedValues, refundableAmount]);
  const { operationId, rotateOperationId } = useFinancialOperationId("refund");
  const [activity,setActivity]=useState<{modeAtConfirmation:"ON"|"OFF";shiftId:string|null}|null>(cashierShiftsEnabled === undefined ? null : {modeAtConfirmation:cashierShiftsEnabled?"ON":"OFF",shiftId:cashierShiftsEnabled?shiftId:null});
  const [activityError,setActivityError]=useState("");
  async function reviewCashierSettings() {
    setActivity(null); setActivityError("");
    try {
      const result=await refundCashierActivityAction(paymentId);
      if(result.ok){
        setActivity(result.activity);
        // Existing explicit mode-rejection review is a rolled-back request,
        // not an unknown outcome. Preserve its key and refund fields.
        if (safeState.message.startsWith("CASHIER_SHIFT_MODE_CHANGED") && submittedValues.current.length) {
          submittedValues.current = submittedValues.current.map(([name,value]) => [name, name === "modeAtConfirmation" ? result.activity.modeAtConfirmation : name === "shiftId" ? result.activity.shiftId ?? "" : value]);
          sessionStorage.setItem(recoveryKey, JSON.stringify(submittedValues.current));
          setLockedValues(submittedValues.current);
        }
      } else setActivityError(result.message);
    } catch { setActivityError("Cashier settings could not be loaded. Try again."); }
  }
  useEffect(()=>{
    if(cashierShiftsEnabled !== undefined)return;
    let active=true;
    setActivity(null);
    void refundCashierActivityAction(paymentId).then(result=>{
      if(!active)return;
      if(result.ok)setActivity(result.activity); else setActivityError(result.message);
    }).catch(()=>{if(active)setActivityError("Cashier settings could not be loaded. Try again.");});
    return ()=>{active=false;};
    // Keep confirmation hints stable for this payment across ordinary rerenders.
    // A changed mode requires the explicit review button, never an automatic retry.
  },[paymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (safeState.status === "success" && safeState.completedOperationId && completedOperation.current !== safeState.completedOperationId) {
      completedOperation.current = safeState.completedOperationId;
      submittedValues.current = [];
      sessionStorage.removeItem(recoveryKey);
      setLockedValues(null);
      rotateOperationId();
      router.refresh();
      onSuccess?.();
    }
  }, [onSuccess, rotateOperationId, router, safeState, recoveryKey]);

  return (
    <form
      ref={form}
      action={formAction}
      className="refund-payment-form"
      onSubmit={(event) => {
        if(submitting.current || pending || !operationId || !activity || packagePurchaseRefund?.unavailableReason){event.preventDefault();return;}
        const data = new FormData(event.currentTarget);
        const amount = lockedValues?.find(([name]) => name === "amount")?.[1] ?? data.get("amount");
        const confirmed = window.confirm(
          `Refund RM${amount} from invoice ${invoiceNumber}? This changes payment totals only; the related order status will stay unchanged.`,
        );

        if (!confirmed) {
          event.preventDefault();
          return;
        }
        submitting.current = true;
        if (!lockedValues) {
          submittedValues.current = [...data.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string");
          sessionStorage.setItem(recoveryKey, JSON.stringify(submittedValues.current));
          setLockedValues(submittedValues.current);
        }
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="operationId" value={lockedValues?.find(([name]) => name === "operationId")?.[1] ?? operationId} />
      <input type="hidden" name="modeAtConfirmation" value={activity?.modeAtConfirmation ?? ""} />
      <input type="hidden" name="shiftId" value={activity?.shiftId ?? ""} />
      {!activity ? <p role="status">{activityError || "Loading cashier settings…"}</p> : <p className="field-helper">Cashier shifts: {activity.modeAtConfirmation}</p>}
      {activityError || safeState.message.startsWith("CASHIER_SHIFT_MODE_CHANGED") ? <button type="button" disabled={pending} onClick={reviewCashierSettings}>Review current cashier settings</button> : null}
      {packageRefund ? (
        <input type="hidden" name="method" value="PACKAGE" />
      ) : null}

      <div className="refund-form-grid">
        {packagePurchaseRefund ? <div className="refund-package-note">
          <span>Full refund total</span>
          <strong>RM{refundableAmount.toFixed(2)}</strong>
          <input type="hidden" name="amount" value={refundableAmount.toFixed(2)} />
          <p>Unused packages can only be refunded in full.</p>
          {packagePurchaseRefund.unavailableReason ? <p role="alert">{packagePurchaseRefund.unavailableReason}</p> : null}
        </div> : <label>
          <span>Refund amount</span>
          <input
            key={refundableAmount}
            name="amount"
            type="number"
            min="0.01"
            max={refundableAmount.toFixed(2)}
            step="0.01"
            defaultValue={refundableAmount.toFixed(2)}
            readOnly={packageRefund || !!lockedValues}
            required
          />
          <small>Remaining refundable: RM{refundableAmount.toFixed(2)}</small>
        </label>}

        {packageRefund ? (
          <div className="refund-package-note">
            <span>Refund method</span>
            <strong>Restore package use</strong>
          </div>
        ) : packagePurchaseRefund ? (
          <input type="hidden" name="method" value={defaultMethod} />
        ) : (
          <label>
            <span>Refund method</span>
            <select
              name="method"
              disabled={!!lockedValues}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {availableRefundMethods.map((refundMethod) => (
                <option key={refundMethod.value} value={refundMethod.value}>
                  {refundMethod.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {!packageRefund && method !== "CASH" ? (
          <label>
            <span>Reference</span>
            <input
              name="reference"
              readOnly={!!lockedValues}
              placeholder="Transaction or bank reference"
              required
            />
          </label>
        ) : (
          <input type="hidden" name="reference" value="" />
        )}

        <label className="refund-reason-field">
          <span>Reason</span>
          <textarea
            name="reason"
            readOnly={!!lockedValues}
            rows={2}
            placeholder="Why is this payment being refunded?"
            required
          />
        </label>
      </div>

      {stockLines.length ? (
        <fieldset className="product-stock-fieldset" disabled={!!lockedValues}>
          <legend>Returned product stock</legend>
          <p className="field-helper">For each returned tracked product, choose an explicit quantity and stock treatment.</p>
          {stockLines.map((line) => (
            <div className="refund-form-grid" key={line.id}>
              <input name="refundItemId" type="hidden" value={line.id} />
              <label><span>{line.name} return quantity</span><input defaultValue="0" max={line.remainingQuantity} min="0" name={`refundQuantity_${line.id}`} step="1" type="number" /></label>
              <label><span>Stock treatment</span><select defaultValue="RESTOCK" name={`refundDisposition_${line.id}`}><option value="RESTOCK">RESTOCK — sellable stock</option><option value="NO_RESTOCK">NO RESTOCK — damaged / not returned</option></select></label>
              <label><span>No-restock reason</span><input name={`refundNoRestockReason_${line.id}`} placeholder="Required when NO RESTOCK" /></label>
            </div>
          ))}
        </fieldset>
      ) : null}

      <div className="refund-form-footer">
        {lockedValues && !pending ? <p role="status">Retry uses the original refund request. Check refund status before retrying.</p> : null}
        <button className="danger-button" type="submit" disabled={pending || !activity || refundableAmount <= 0 || !!packagePurchaseRefund?.unavailableReason}>
          {pending ? "Processing..." : packagePurchaseRefund ? "Process full refund" : "Process refund"}
        </button>
        {safeState.status !== "idle" ? (
          <p className={`form-message ${safeState.status}`}>
            {safeState.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

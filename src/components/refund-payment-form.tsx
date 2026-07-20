"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  refundPaymentAction,
  type RefundPaymentState,
} from "@/app/(business)/invoices/actions";

type RefundPaymentFormProps = {
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  originalMethod: string;
  refundableAmount: number;
  onSuccess?: () => void;
};

const initialState: RefundPaymentState = {
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
  invoiceId,
  invoiceNumber,
  paymentId,
  originalMethod,
  refundableAmount,
  onSuccess,
}: RefundPaymentFormProps) {
  const router = useRouter();
  const packageRefund = originalMethod === "PACKAGE";
  const defaultMethod = packageRefund
    ? "PACKAGE"
    : refundMethods.some((method) => method.value === originalMethod)
      ? originalMethod
      : "CASH";
  const [method, setMethod] = useState(defaultMethod);
  const [state, formAction, pending] = useActionState(
    refundPaymentAction,
    initialState,
  );
  const safeState = state ?? initialState;

  useEffect(() => {
    if (safeState.status === "success") {
      router.refresh();
      onSuccess?.();
    }
  }, [onSuccess, router, safeState.status]);

  return (
    <form
      action={formAction}
      className="refund-payment-form"
      onSubmit={(event) => {
        const amount = new FormData(event.currentTarget).get("amount");
        const confirmed = window.confirm(
          `Refund RM${amount} from invoice ${invoiceNumber}? This changes payment totals only; the related order status will stay unchanged.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      {packageRefund ? (
        <input type="hidden" name="method" value="PACKAGE" />
      ) : null}

      <div className="refund-form-grid">
        <label>
          <span>Refund amount</span>
          <input
            name="amount"
            type="number"
            min="0.01"
            max={refundableAmount.toFixed(2)}
            step="0.01"
            defaultValue={refundableAmount.toFixed(2)}
            readOnly={packageRefund}
            required
          />
          <small>Available: RM{refundableAmount.toFixed(2)}</small>
        </label>

        {packageRefund ? (
          <div className="refund-package-note">
            <span>Refund method</span>
            <strong>Restore package use</strong>
          </div>
        ) : (
          <label>
            <span>Refund method</span>
            <select
              name="method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {refundMethods.map((refundMethod) => (
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
            rows={2}
            placeholder="Why is this payment being refunded?"
            required
          />
        </label>
      </div>

      <div className="refund-form-footer">
        <button className="danger-button" type="submit" disabled={pending}>
          {pending ? "Processing..." : "Process refund"}
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

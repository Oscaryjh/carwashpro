"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import {
  recordSalonAppointmentPaymentAction,
  type SalonAppointmentPaymentState,
  type SalonCheckoutInvoiceSummary,
} from "@/app/appointments/actions";
import { calculateTax, type TaxLineInput } from "@/lib/tax/calculator";

type SalonAppointmentPaymentFormProps = {
  appointmentId: string;
  balance: number;
  hasInvoice: boolean;
  hasOpenShift: boolean;
  subtotal: number;
  totalAmount: number;
  taxLines: TaxLineInput[];
  sstEnabled: boolean;
  sstLabel: string;
  sstRate: number;
  onCheckoutComplete: (invoice: SalonCheckoutInvoiceSummary) => void;
};

const initialPaymentState: SalonAppointmentPaymentState = {
  status: "idle",
  message: "",
  invoiceId: null,
  invoice: null,
};

export function SalonAppointmentPaymentForm({
  appointmentId,
  balance,
  hasInvoice,
  hasOpenShift,
  subtotal,
  totalAmount,
  taxLines,
  sstEnabled,
  sstLabel,
  sstRate,
  onCheckoutComplete,
}: SalonAppointmentPaymentFormProps) {
  const router = useRouter();
  const [method, setMethod] = useState("CASH");
  const [depositMethod, setDepositMethod] = useState("CASH");
  const [discount, setDiscount] = useState("0");
  const [deposit, setDeposit] = useState("0");
  const [tip, setTip] = useState("0");
  const [cashReceived, setCashReceived] = useState("");
  const [amount, setAmount] = useState(
    hasInvoice ? balance.toFixed(2) : totalAmount.toFixed(2),
  );
  const [amountEdited, setAmountEdited] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const cashReceivedRef = useRef<HTMLInputElement>(null);
  const [paymentState, formAction, pending] = useActionState(
    recordSalonAppointmentPaymentAction,
    initialPaymentState,
  );
  const tax = calculateTax({
    sstEnabled,
    sstLabel,
    sstRate,
    lines: taxLines,
    discount: Number(discount || 0),
    tip: Number(tip || 0),
  });
  const total = tax.total;
  const balancePaymentCents = Math.max(0, Math.round((Number(amount) || 0) * 100));
  const depositCents = Math.max(0, Math.round((Number(deposit) || 0) * 100));
  const cashDueCents = (method === "CASH" ? balancePaymentCents : 0)
    + (depositMethod === "CASH" ? depositCents : 0);
  const cashReceivedCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const cashPaymentReady = cashDueCents === 0 || cashReceivedCents >= cashDueCents;
  const cashChange = Math.max(0, cashReceivedCents - cashDueCents) / 100;

  useEffect(() => {
    if (!amountEdited) {
      setAmount(hasInvoice ? balance.toFixed(2) : total.toFixed(2));
    }
  }, [amountEdited, balance, hasInvoice, total]);

  useEffect(() => {
    if (paymentState.status === "success" && paymentState.invoice) {
      onCheckoutComplete(paymentState.invoice);
      router.refresh();
    }
  }, [onCheckoutComplete, paymentState.invoice, paymentState.status, router]);

  function validatePayment(event: FormEvent<HTMLFormElement>) {
    if (!hasOpenShift) {
      event.preventDefault();
      return;
    }

    const form = event.currentTarget;
    const paymentAmount = Number(
      (form.elements.namedItem("amount") as HTMLInputElement | null)?.value || 0,
    );
    const depositAmount = Number(
      (form.elements.namedItem("depositAmount") as HTMLInputElement | null)?.value || 0,
    );

    if (paymentAmount <= 0 && depositAmount <= 0) {
      event.preventDefault();
      setValidationError("Enter a payment amount or deposit amount.");
      return;
    }

    if (!cashPaymentReady) {
      event.preventDefault();
      setValidationError(`Enter at least ${formatMoney(cashDueCents / 100)} cash received.`);
      cashReceivedRef.current?.focus();
      return;
    }

    setValidationError(null);
  }

  return (
    <form
      action={formAction}
      className="payment-form salon-payment-form"
      onSubmit={validatePayment}
    >
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {!hasInvoice ? (
        <div className="salon-checkout-adjustments">
          <label>
            Discount
            <input
              min="0"
              name="discountAmount"
              onChange={(event) => setDiscount(event.target.value)}
              step="0.01"
              type="number"
              value={discount}
            />
          </label>
          <label>
            Tip
            <input
              min="0"
              name="tipAmount"
              onChange={(event) => setTip(event.target.value)}
              step="0.01"
              type="number"
              value={tip}
            />
          </label>
        </div>
      ) : null}
      <div className="salon-checkout-summary" aria-live="polite">
        <span>Subtotal <strong>RM{subtotal.toFixed(2)}</strong></span>
        {!hasInvoice && Number(discount) > 0 ? <span>Discount <strong>-RM{Number(discount).toFixed(2)}</strong></span> : null}
        {!hasInvoice && tax.tax > 0 ? (
          <span>
            {formatTaxLabel(tax.taxLabel, tax.taxRate)}
            <strong>RM{tax.tax.toFixed(2)}</strong>
          </span>
        ) : null}
        {!hasInvoice && Number(tip) > 0 ? <span>Tip <strong>RM{Number(tip).toFixed(2)}</strong></span> : null}
        <span className="is-total">Total <strong>RM{(hasInvoice ? totalAmount : total).toFixed(2)}</strong></span>
      </div>
      {!hasInvoice ? (
        <div className="salon-checkout-deposit">
          <label>
            Deposit
            <input
              max={Math.max(0, total).toFixed(2)}
              min="0"
              name="depositAmount"
              onChange={(event) => setDeposit(event.target.value)}
              step="0.01"
              type="number"
              value={deposit}
            />
          </label>
          <label>
            Deposit method
            <select
              name="depositMethod"
              onChange={(event) => setDepositMethod(event.target.value)}
              value={depositMethod}
            >
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="DUITNOW">DuitNow</option>
              <option value="EWALLET">E-wallet</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          </label>
          {depositMethod !== "CASH" ? (
            <label className="salon-checkout-reference-field">
              Deposit reference
              <input name="depositReference" required />
            </label>
          ) : null}
        </div>
      ) : null}
      <label className="salon-checkout-balance-field">
        {hasInvoice ? "Payment amount" : "Balance payment"}
        <input
          max={(hasInvoice ? balance : total).toFixed(2)}
          min="0"
          name="amount"
          onChange={(event) => {
            setAmountEdited(true);
            setAmount(event.target.value);
          }}
          step="0.01"
          type="number"
          value={amount}
        />
      </label>
      {validationError ? <p className="error salon-payment-validation-error">{validationError}</p> : null}
      <label className="salon-checkout-payment-method-field">
        Payment method
        <select
          name="method"
          onChange={(event) => setMethod(event.target.value)}
          value={method}
        >
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="DUITNOW">DuitNow</option>
          <option value="EWALLET">E-wallet</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
        </select>
      </label>
      {method !== "CASH" ? (
        <label className="salon-checkout-reference-field">
          Reference
          <input name="reference" required />
        </label>
      ) : null}
      {cashDueCents > 0 ? (
        <div className="salon-cash-tender">
          <label>
            Cash received
            <input
              aria-invalid={!cashPaymentReady}
              inputMode="decimal"
              min="0"
              onChange={(event) => setCashReceived(event.target.value)}
              placeholder={formatMoney(cashDueCents / 100)}
              ref={cashReceivedRef}
              step="0.01"
              type="number"
              value={cashReceived}
            />
          </label>
          <div className="salon-cash-change" aria-live="polite">
            <span>Change</span>
            <strong>{formatMoney(cashChange)}</strong>
          </div>
        </div>
      ) : null}
      {!hasOpenShift ? (
        <div className="salon-payment-action-error" role="alert">
          <span>Start a cashier shift before checkout.</span>
          <Link href="/closing">Open Shift Closing</Link>
        </div>
      ) : paymentState.status === "error" ? (
        <div className="salon-payment-action-error" role="alert">
          <span>{paymentState.message}</span>
          {paymentState.message === "Start a cashier shift before checkout." ? (
            <Link href="/closing">Open Shift Closing</Link>
          ) : null}
        </div>
      ) : null}
      <button
        className="salon-payment-submit"
        disabled={pending || !hasOpenShift || !cashPaymentReady}
        type="submit"
      >
        {pending
          ? "Processing..."
          : !cashPaymentReady
            ? "Enter cash received"
          : hasInvoice
            ? "Record payment"
            : "Create invoice & checkout"}
      </button>
    </form>
  );
}

function formatTaxLabel(label: string, rate: number) {
  if (rate <= 0) return label;
  const formattedRate = Number.isInteger(rate)
    ? rate.toFixed(0)
    : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${label} (${formattedRate}%)`;
}

function formatMoney(value: number) {
  return `RM${value.toFixed(2)}`;
}

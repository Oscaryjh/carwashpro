"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import {
  recordSalonAppointmentPaymentAction,
  type SalonAppointmentPaymentState,
  type SalonCheckoutInvoiceSummary,
} from "@/app/(business)/appointments/actions";
import { MoneyNumpadInput } from "@/components/money-numpad-input";
import { calculateTax, type TaxLineInput } from "@/lib/tax/calculator";

type SalonAppointmentPaymentFormProps = {
  appointmentId: string;
  availablePackages: {
    id: string;
    name: string;
    remainingUses: number;
    totalUses: number;
    serviceId: string;
    serviceName: string;
  }[];
  balance: number;
  checkoutReady?: boolean;
  hasInvoice: boolean;
  hasOpenShift: boolean;
  subtotal: number;
  totalAmount: number;
  taxLines: TaxLineInput[];
  checkoutItems: {
    id: string;
    type: "service" | "product" | "package";
  }[];
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
  availablePackages,
  balance,
  checkoutReady = true,
  hasInvoice,
  hasOpenShift,
  subtotal,
  totalAmount,
  taxLines,
  checkoutItems,
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
  const [selectedCustomerPackageIds, setSelectedCustomerPackageIds] = useState<string[]>([]);
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
  const safePaymentState = paymentState ?? initialPaymentState;
  const tax = calculateTax({
    sstEnabled,
    sstLabel,
    sstRate,
    lines: taxLines,
    discount: Number(discount || 0),
    tip: Number(tip || 0),
  });
  const total = tax.total;
  const selectedCustomerPackages = availablePackages.filter((customerPackage) =>
    selectedCustomerPackageIds.includes(customerPackage.id),
  );
  const selectedPackageApplications = hasInvoice
    ? []
    : selectedCustomerPackages.flatMap((customerPackage) => {
        const lineIndex = checkoutItems.findIndex(
          (item) => item.type === "service" && item.id === customerPackage.serviceId,
        );
        if (lineIndex < 0) return [];

        const lineTotal = taxLines[lineIndex]?.lineTotal ?? 0;
        const coveredAmount = Math.max(
          0,
          lineTotal - (tax.lineDiscount[lineIndex] ?? 0) + (tax.lineTax[lineIndex] ?? 0),
        );
        if (coveredAmount <= 0) return [];

        return [{
          id: customerPackage.id,
          packageName: customerPackage.name,
          serviceName: customerPackage.serviceName,
          coveredAmount,
        }];
      });
  const packageCoverage = selectedPackageApplications.reduce(
    (sum, application) => sum + application.coveredAmount,
    0,
  );
  const amountDue = hasInvoice ? balance : Math.max(0, total - packageCoverage);
  const balancePaymentCents = Math.max(0, Math.round((Number(amount) || 0) * 100));
  const depositCents = Math.max(0, Math.round((Number(deposit) || 0) * 100));
  const cashDueCents = (method === "CASH" ? balancePaymentCents : 0)
    + (depositMethod === "CASH" ? depositCents : 0);
  const cashReceivedCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const cashPaymentReady = cashDueCents === 0 || cashReceivedCents >= cashDueCents;
  const cashChange = Math.max(0, cashReceivedCents - cashDueCents) / 100;

  useEffect(() => {
    if (!amountEdited) {
      setAmount(amountDue.toFixed(2));
    }
  }, [amountDue, amountEdited]);

  useEffect(() => {
    if (safePaymentState.status === "success" && safePaymentState.invoice) {
      onCheckoutComplete(safePaymentState.invoice);
      router.refresh();
    }
  }, [onCheckoutComplete, router, safePaymentState.invoice, safePaymentState.status]);

  function validatePayment(event: FormEvent<HTMLFormElement>) {
    if (!checkoutReady) {
      event.preventDefault();
      return;
    }

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
    const packageIds = formDataValues(form, "customerPackageIds");

    if (paymentAmount <= 0 && depositAmount <= 0 && packageIds.length === 0) {
      event.preventDefault();
      setValidationError("Enter a payment amount or deposit amount.");
      return;
    }

    if (!cashPaymentReady) {
      event.preventDefault();
      setValidationError(`Enter at least ${formatMoney(cashDueCents / 100)} cash received.`);
      cashReceivedRef.current?.click();
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
      {selectedCustomerPackageIds.map((customerPackageId) => (
        <input
          key={customerPackageId}
          name="customerPackageIds"
          type="hidden"
          value={customerPackageId}
        />
      ))}
      {!hasInvoice && availablePackages.length ? (
        <section className="salon-checkout-package-uses">
          <div className="salon-checkout-package-heading">
            <div>
              <strong>Use customer package</strong>
              <span>Select a package to cover its matching service.</span>
            </div>
            {selectedCustomerPackages.length ? (
              <span>{selectedCustomerPackages.length} selected</span>
            ) : null}
          </div>
          <div className="salon-checkout-package-options">
            {availablePackages.map((customerPackage) => {
              const selected = selectedCustomerPackageIds.includes(customerPackage.id);
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "is-selected" : undefined}
                  key={customerPackage.id}
                  onClick={() => {
                    setAmountEdited(false);
                    setSelectedCustomerPackageIds((current) => {
                      if (current.includes(customerPackage.id)) {
                        return current.filter((id) => id !== customerPackage.id);
                      }
                      const sameServiceIds = new Set(
                        availablePackages
                          .filter((item) => item.serviceId === customerPackage.serviceId)
                          .map((item) => item.id),
                      );
                      return [
                        ...current.filter((id) => !sameServiceIds.has(id)),
                        customerPackage.id,
                      ];
                    });
                  }}
                  type="button"
                >
                  <span>
                    <strong>{customerPackage.name}</strong>
                    <small>{customerPackage.serviceName}</small>
                  </span>
                  <span className="salon-package-use-balance">
                    {customerPackage.remainingUses}/{customerPackage.totalUses} uses
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
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
        {selectedPackageApplications.length ? (
          <div className="salon-checkout-voucher-breakdown">
            {selectedPackageApplications.map((application) => (
              <div className="salon-checkout-voucher-row" key={application.id}>
                <span>
                  <strong>{application.serviceName}</strong>
                  <small>{application.packageName} voucher used</small>
                </span>
                <span>
                  <small>Covered RM{application.coveredAmount.toFixed(2)}</small>
                  <strong>RM0.00</strong>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {!hasInvoice && packageCoverage > 0 ? (
          <span>Voucher total <strong>-RM{packageCoverage.toFixed(2)}</strong></span>
        ) : null}
        <span className="is-total">Total <strong>RM{(hasInvoice ? totalAmount : total).toFixed(2)}</strong></span>
        {!hasInvoice && packageCoverage > 0 ? (
          <span className="is-due">Amount due <strong>RM{amountDue.toFixed(2)}</strong></span>
        ) : null}
      </div>
      {!hasInvoice ? (
        <div className="salon-checkout-deposit">
          <label>
            Deposit
            <input
              max={amountDue.toFixed(2)}
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
      {validationError ? <p className="error salon-payment-validation-error">{validationError}</p> : null}
      <div className="salon-checkout-payment-fields">
        <label className="salon-checkout-balance-field">
          {hasInvoice ? "Payment amount" : "Balance payment"}
          <input
            max={amountDue.toFixed(2)}
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
        <div className="salon-checkout-payment-method-field">
          <span>Payment method</span>
          <span aria-label="Payment method" className="salon-checkout-payment-methods" role="group">
            {[
              { label: "Cash", value: "CASH" },
              { label: "Card", value: "CARD" },
              { label: "E-Wallet", value: "EWALLET" },
              { label: "Bank", value: "BANK_TRANSFER" },
            ].map((paymentMethod) => (
              <label
                className={method === paymentMethod.value ? "is-selected" : undefined}
                key={paymentMethod.value}
              >
                <input
                  checked={method === paymentMethod.value}
                  name="method"
                  onChange={() => {
                    setMethod(paymentMethod.value);
                    if (paymentMethod.value === "CASH") {
                      window.requestAnimationFrame(() => cashReceivedRef.current?.click());
                    }
                  }}
                  type="radio"
                  value={paymentMethod.value}
                />
                <span>{paymentMethod.label}</span>
              </label>
            ))}
          </span>
        </div>
        {method !== "CASH" ? (
          <label className="salon-checkout-reference-field">
            Reference
            <input name="reference" required />
          </label>
        ) : null}
      </div>
      {cashDueCents > 0 ? (
        <div className="salon-cash-tender">
          <label>
            Cash received
            <MoneyNumpadInput
              aria-invalid={!cashPaymentReady}
              amountDue={cashDueCents / 100}
              onValueChange={setCashReceived}
              placeholder={formatMoney(cashDueCents / 100)}
              ref={cashReceivedRef}
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
      ) : safePaymentState.status === "error" ? (
        <div className="salon-payment-action-error" role="alert">
          <span>{safePaymentState.message}</span>
          {safePaymentState.message === "Start a cashier shift before checkout." ? (
            <Link href="/closing">Open Shift Closing</Link>
          ) : null}
        </div>
      ) : null}
      <button
        className="salon-payment-submit"
        disabled={pending || !checkoutReady || !hasOpenShift || !cashPaymentReady}
        type="submit"
      >
        {pending
          ? "Processing..."
          : !cashPaymentReady
            ? "Enter cash received"
          : hasInvoice
            ? "Record payment"
            : amountDue === 0 && selectedCustomerPackageIds.length
              ? "Use package & checkout"
              : "Create invoice & checkout"}
      </button>
    </form>
  );
}

function formDataValues(form: HTMLFormElement, name: string) {
  return [...new FormData(form).getAll(name)].map(String).filter(Boolean);
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

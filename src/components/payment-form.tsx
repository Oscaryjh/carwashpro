"use client";
import { CheckoutAttribution } from "@/components/performance/checkout-attribution";
import { SafePaymentForm } from "@/components/performance/safe-payment-form";

import { useEffect, useState } from "react";
import { PACKAGE_PAYMENT_PREVIEW_EVENT } from "@/components/pos-payment-preview";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";
import { FinancialSubmitButton } from "@/components/financial-submit-button";

type PaymentFormProps = {
  action: (formData: FormData) => Promise<void>;
  workOrderId: string;
  balance: number;
  variant?: "default" | "pos";
  defaultPackageSelected?: boolean;
};

export function PaymentForm({
  action,
  workOrderId,
  balance,
  variant = "default",
  defaultPackageSelected = false,
}: PaymentFormProps) {
  const isPos = variant === "pos";
  const [method, setMethod] = useState("CASH");
  const [isPackageSelected, setIsPackageSelected] = useState(defaultPackageSelected);
  const isReferenceRequired = method !== "CASH";
  const { operationId } = useFinancialOperationId("payment");

  useEffect(() => {
    function handlePackagePreview(event: Event) {
      const detail = (event as CustomEvent<{ selected: boolean }>).detail;
      setIsPackageSelected(Boolean(detail?.selected));
    }

    window.addEventListener(PACKAGE_PAYMENT_PREVIEW_EVENT, handlePackagePreview);
    return () => {
      window.removeEventListener(PACKAGE_PAYMENT_PREVIEW_EVENT, handlePackagePreview);
    };
  }, []);

  return (
    <SafePaymentForm
      action={action}
      className={[
        "form",
        isPos ? "pos-payment-form" : "",
        isPackageSelected ? "is-muted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="operationId" value={operationId} />
      <div className={isPos ? "pos-payment-fields" : "field-grid"}>
        <label>
          <span>Payment amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={balance.toFixed(2)}
            defaultValue={balance.toFixed(2)}
            disabled={isPackageSelected}
            required
          />
        </label>
        <label>
          <span>Payment method</span>
          {isPos ? (
            <div className="pos-method-grid">
              {[
                ["CASH", "Cash"],
                ["CARD", "Card"],
                ["EWALLET", "E-wallet"],
                ["BANK_TRANSFER", "Bank"],
              ].map(([value, label]) => (
                <label className="pos-method-option" key={value}>
                  <input
                    name="method"
                    type="radio"
                    value={value}
                    defaultChecked={value === "CASH"}
                    onChange={() => setMethod(value)}
                    disabled={isPackageSelected}
                    required
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          ) : (
            <select
              name="method"
              defaultValue="CASH"
              onChange={(event) => setMethod(event.target.value)}
              disabled={isPackageSelected}
              required
            >
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="EWALLET">E-wallet</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          )}
        </label>
        <label>
          <span>{isReferenceRequired ? "Reference required" : "Reference optional"}</span>
          <input
            name="reference"
            disabled={isPackageSelected}
            required={!isPackageSelected && isReferenceRequired}
          />
        </label>
      </div>
      <CheckoutAttribution workOrderId={workOrderId} exempt={isPackageSelected} />
      <div className="form-actions">
        <FinancialSubmitButton disabled={isPackageSelected} pendingLabel="Recording payment...">
          {isPackageSelected
            ? "Use Pay with package below"
            : isPos
              ? "Check out"
              : "Record payment"}
        </FinancialSubmitButton>
      </div>
    </SafePaymentForm>
  );
}

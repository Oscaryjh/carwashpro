"use client";

import { useEffect, useState } from "react";
import { PACKAGE_PAYMENT_PREVIEW_EVENT } from "@/components/pos-payment-preview";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";
import { FinancialSubmitButton } from "@/components/financial-submit-button";
import { SafePaymentForm, type PaymentFormAction } from "@/components/performance/safe-payment-form";

export type PackagePaymentOption = {
  id: string;
  packageName: string;
  purchaseBranchName?: string;
  remainingUses: number;
  totalUses: number;
};

type PackagePaymentFormProps = {
  cashierShiftsEnabled?: boolean;
  shiftId?: string | null;
  action: PaymentFormAction;
  workOrderId: string;
  customerPackages: PackagePaymentOption[];
  variant?: "default" | "pos";
  selectedPackageId?: string;
  onSelectedPackageIdChange?: (packageId: string) => void;
};

export function PackagePaymentForm({
  cashierShiftsEnabled = true,
  shiftId = null,
  action,
  workOrderId,
  customerPackages,
  variant = "default",
  selectedPackageId,
  onSelectedPackageIdChange,
}: PackagePaymentFormProps) {
  const [internalSelectedPackageId, setInternalSelectedPackageId] = useState("");
  const currentSelectedPackageId = selectedPackageId ?? internalSelectedPackageId;
  const { operationId } = useFinancialOperationId("package-redemption");

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(PACKAGE_PAYMENT_PREVIEW_EVENT, {
        detail: { selected: Boolean(currentSelectedPackageId) },
      }),
    );
  }, [currentSelectedPackageId]);

  if (!customerPackages.length) {
    return (
      <p className="empty-state">
        This customer has no active package with Uses Left.
      </p>
    );
  }

  const isPos = variant === "pos";
  function handlePackageChange(packageId: string) {
    if (selectedPackageId === undefined) {
      setInternalSelectedPackageId(packageId);
    }
    onSelectedPackageIdChange?.(packageId);
  }

  return (
    <SafePaymentForm action={action} cashierActivity={{ modeAtConfirmation: cashierShiftsEnabled ? "ON" : "OFF", shiftId: cashierShiftsEnabled ? shiftId : null }} className={isPos ? "form pos-package-form" : "form"}>
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="operationId" value={operationId} />
      <input type="hidden" name="modeAtConfirmation" value={cashierShiftsEnabled ? "ON" : "OFF"} />
      <input type="hidden" name="shiftId" value={cashierShiftsEnabled ? shiftId ?? "" : ""} />
      <div className={isPos ? "pos-payment-fields" : "field-grid"}>
        <label>
          <span>Prepaid package</span>
          <select
            name="customerPackageId"
            value={currentSelectedPackageId}
            onChange={(event) => handlePackageChange(event.target.value)}
            required
          >
            <option value="">Select prepaid package</option>
            {customerPackages.map((customerPackage) => (
              <option key={customerPackage.id} value={customerPackage.id}>
                {customerPackage.packageName} - {customerPackage.remainingUses}/
                {customerPackage.totalUses} Uses Left
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <FinancialSubmitButton
          disabled={!currentSelectedPackageId}
          pendingLabel="Redeeming package..."
        >
          Pay with package
        </FinancialSubmitButton>
      </div>
    </SafePaymentForm>
  );
}

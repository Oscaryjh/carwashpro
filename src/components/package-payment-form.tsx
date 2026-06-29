"use client";

import { useEffect, useState } from "react";
import { PACKAGE_PAYMENT_PREVIEW_EVENT } from "@/components/pos-payment-preview";

export type PackagePaymentOption = {
  id: string;
  packageName: string;
  remainingUses: number;
  totalUses: number;
};

type PackagePaymentFormProps = {
  action: (formData: FormData) => Promise<void>;
  workOrderId: string;
  customerPackages: PackagePaymentOption[];
  variant?: "default" | "pos";
  selectedPackageId?: string;
  onSelectedPackageIdChange?: (packageId: string) => void;
};

export function PackagePaymentForm({
  action,
  workOrderId,
  customerPackages,
  variant = "default",
  selectedPackageId,
  onSelectedPackageIdChange,
}: PackagePaymentFormProps) {
  const [internalSelectedPackageId, setInternalSelectedPackageId] = useState("");
  const currentSelectedPackageId = selectedPackageId ?? internalSelectedPackageId;

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
        This customer has no active prepaid wash package with remaining uses.
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
    <form action={action} className={isPos ? "form pos-package-form" : "form"}>
      <input type="hidden" name="workOrderId" value={workOrderId} />
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
                {customerPackage.totalUses} washes left
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={!currentSelectedPackageId}>
          Pay with package
        </button>
      </div>
    </form>
  );
}

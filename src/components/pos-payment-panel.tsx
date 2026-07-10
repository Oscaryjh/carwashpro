"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PackagePaymentOption } from "@/components/package-payment-form";
import { PaymentForm } from "@/components/payment-form";
import {
  PACKAGE_PAYMENT_PREVIEW_EVENT,
  PosAmountDuePreview,
} from "@/components/pos-payment-preview";

type PosPaymentPanelProps = {
  recordPaymentAction: (formData: FormData) => Promise<void>;
  usePackagePaymentAction: (formData: FormData) => Promise<void>;
  workOrderId: string;
  balance: number;
  canPay: boolean;
  customerPackages: PackagePaymentOption[];
  invoice?: {
    id: string;
    invoiceNumber: string;
  } | null;
};

export function PosPaymentPanel({
  recordPaymentAction,
  usePackagePaymentAction,
  workOrderId,
  balance,
  canPay,
  customerPackages,
  invoice,
}: PosPaymentPanelProps) {
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const selectedPackage = customerPackages.find(
    (customerPackage) => customerPackage.id === selectedPackageId,
  );
  const isPackageSelected = Boolean(selectedPackageId);
  const hasPackages = customerPackages.length > 0;

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(PACKAGE_PAYMENT_PREVIEW_EVENT, {
        detail: {
          selected: isPackageSelected,
          packageName: selectedPackage?.packageName,
          remainingUses: selectedPackage?.remainingUses,
          totalUses: selectedPackage?.totalUses,
        },
      }),
    );
  }, [
    isPackageSelected,
    selectedPackage?.packageName,
    selectedPackage?.remainingUses,
    selectedPackage?.totalUses,
  ]);

  return (
    <div className="pos-payment-panel panel">
      <PosAmountDuePreview
        balance={balance}
        isPackageSelected={isPackageSelected}
      />

      {canPay ? (
        <section className="pos-payment-section">
          <h2>Package</h2>
          {hasPackages ? (
            <form action={usePackagePaymentAction} className="form pos-package-form">
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <input
                type="hidden"
                name="customerPackageId"
                value={selectedPackageId}
              />
              <div className="pos-package-options">
                {customerPackages.map((customerPackage) => {
                  const isSelected = selectedPackageId === customerPackage.id;

                  return (
                    <button
                      className={`pos-package-option ${isSelected ? "is-selected" : ""}`}
                      key={customerPackage.id}
                      type="button"
                      onClick={() =>
                        setSelectedPackageId(isSelected ? "" : customerPackage.id)
                      }
                    >
                      <span>{customerPackage.packageName}</span>
                      <strong>
                        {customerPackage.remainingUses}/{customerPackage.totalUses}
                      </strong>
                      <small>{customerPackage.purchaseBranchName}</small>
                      <small>washes left</small>
                    </button>
                  );
                })}
              </div>
              {isPackageSelected ? (
                <div className="form-actions">
                  <button type="submit">Check out</button>
                </div>
              ) : null}
            </form>
          ) : (
            <p className="empty-state">
              This customer has no active prepaid wash package with remaining uses.
            </p>
          )}
          {isPackageSelected ? (
            <button
              className="secondary-action-button"
              type="button"
              onClick={() => setSelectedPackageId("")}
            >
              Use actual payment instead
            </button>
          ) : null}
        </section>
      ) : null}

      {canPay && (!hasPackages || !isPackageSelected) ? (
        <section className="pos-payment-section">
          <h2>Payment</h2>
          <PaymentForm
            action={recordPaymentAction}
            workOrderId={workOrderId}
            balance={balance}
            variant="pos"
          />
        </section>
      ) : null}

      {!canPay ? (
        <section className="pos-payment-section">
          <p className="empty-state">This job is fully paid or cannot accept payment.</p>
        </section>
      ) : null}

      {invoice ? (
        <Link className="secondary-link-button" href={`/invoices/${invoice.id}`}>
          View invoice {invoice.invoiceNumber}
        </Link>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

export const PACKAGE_PAYMENT_PREVIEW_EVENT = "washflow:package-payment-preview";

type PackagePaymentPreviewDetail = {
  selected: boolean;
  packageName?: string;
  remainingUses?: number;
  totalUses?: number;
};

function usePackagePaymentPreview(defaultSelected = false) {
  const [preview, setPreview] = useState<PackagePaymentPreviewDetail>({
    selected: defaultSelected,
  });

  useEffect(() => {
    function handlePreview(event: Event) {
      const detail = (event as CustomEvent<PackagePaymentPreviewDetail>).detail;
      setPreview({
        selected: Boolean(detail?.selected),
        packageName: detail?.packageName,
        remainingUses: detail?.remainingUses,
        totalUses: detail?.totalUses,
      });
    }

    window.addEventListener(PACKAGE_PAYMENT_PREVIEW_EVENT, handlePreview);
    return () => {
      window.removeEventListener(PACKAGE_PAYMENT_PREVIEW_EVENT, handlePreview);
    };
  }, []);

  return preview;
}

export function PosAmountDuePreview({
  balance,
  defaultPackageSelected = false,
  isPackageSelected,
}: {
  balance: number;
  defaultPackageSelected?: boolean;
  isPackageSelected?: boolean;
}) {
  const preview = usePackagePaymentPreview(defaultPackageSelected);
  const selected = isPackageSelected ?? preview.selected;

  return (
    <div className="pos-payment-hero">
      <span>Amount due</span>
      <strong>RM{(selected ? 0 : balance).toFixed(2)}</strong>
      {selected ? <small>Covered by prepaid package</small> : null}
    </div>
  );
}

export function PosReceiptTotalsPreview({
  total,
  paidAmount,
  balance,
  defaultPackageSelected = false,
}: {
  total: number;
  paidAmount: number;
  balance: number;
  defaultPackageSelected?: boolean;
}) {
  const packagePreview = usePackagePaymentPreview(defaultPackageSelected);
  const isPackageSelected = packagePreview.selected;
  const remainingAfter =
    typeof packagePreview.remainingUses === "number"
      ? Math.max(packagePreview.remainingUses - 1, 0)
      : null;

  return (
    <div className="pos-receipt-totals">
      <div>
        <span>Total</span>
        <strong>RM{total.toFixed(2)}</strong>
      </div>
      <div>
        <span>Paid</span>
        <strong>{isPackageSelected ? "Paid by prepaid" : `RM${paidAmount.toFixed(2)}`}</strong>
      </div>
      {isPackageSelected ? (
        <div className="pos-package-deduction-preview">
          <span>Package deducted</span>
          <strong>{packagePreview.packageName ?? "Prepaid package"}</strong>
          {remainingAfter !== null && packagePreview.totalUses ? (
            <small>
              1 wash used, {remainingAfter}/{packagePreview.totalUses} left after
              checkout
            </small>
          ) : (
            <small>1 wash will be deducted after checkout</small>
          )}
        </div>
      ) : null}
      <div className="is-balance">
        <span>Balance</span>
        <strong>RM{(isPackageSelected ? 0 : balance).toFixed(2)}</strong>
      </div>
    </div>
  );
}

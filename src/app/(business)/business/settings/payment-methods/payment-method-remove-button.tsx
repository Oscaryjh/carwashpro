"use client";

import type { MouseEvent } from "react";
import { deleteBusinessPaymentMethodAction } from "@/app/(business)/business/settings/payment-method-actions";

type PaymentMethodRemoveButtonProps = {
  className: string;
  methodLabel: string;
};

export function PaymentMethodRemoveButton({
  className,
  methodLabel,
}: PaymentMethodRemoveButtonProps) {
  function confirmRemoval(event: MouseEvent<HTMLButtonElement>) {
    const confirmed = window.confirm(
      `Remove ${methodLabel}? This is only allowed when the method has no payment history.`,
    );
    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <button
      className={className}
      formAction={deleteBusinessPaymentMethodAction}
      type="submit"
      onClick={confirmRemoval}
    >
      Remove
    </button>
  );
}

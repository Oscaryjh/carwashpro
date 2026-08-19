"use client";

import type { MouseEvent } from "react";

type PaymentMethodVisibilityButtonProps = {
  active: boolean;
  className: string;
  methodLabel: string;
};

export function PaymentMethodVisibilityButton({
  active,
  className,
  methodLabel,
}: PaymentMethodVisibilityButtonProps) {
  function updateVisibility(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const visibilityField = form?.elements.namedItem("active");

    if (!(visibilityField instanceof HTMLSelectElement)) {
      event.preventDefault();
      return;
    }

    if (active) {
      const confirmed = window.confirm(
        `Remove ${methodLabel} from checkout? It will remain in Settings so existing reports stay intact.`,
      );
      if (!confirmed) {
        event.preventDefault();
        return;
      }
    }

    visibilityField.value = active ? "false" : "true";
  }

  return (
    <button className={className} type="submit" onClick={updateVisibility}>
      {active ? "Remove from checkout" : "Show at checkout"}
    </button>
  );
}

"use client";

import { useState } from "react";
import {
  AppointmentInvoiceModal,
  type InvoiceModalSummary,
} from "@/components/appointment-invoice-modal";

type InvoiceViewButtonProps = {
  invoice: InvoiceModalSummary;
};

export function InvoiceViewButton({ invoice }: InvoiceViewButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="invoice-table-view-button"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        View
      </button>
      {isOpen ? (
        <AppointmentInvoiceModal
          invoice={invoice}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { formatTaxLabel } from "@/lib/tax/format";

type AppointmentInvoiceModalProps = {
  invoice: InvoiceModalSummary;
  onClose: () => void;
  onDone?: () => void;
};

export type InvoiceModalSummary = {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  customerName: string;
  customerPhone: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  tipAmount: number;
  taxAmount: number;
  taxRate: number;
  taxLabel: string | null;
  total: number;
  paidAmount: number;
  balance: number;
};

export function AppointmentInvoiceModal({ invoice, onClose, onDone }: AppointmentInvoiceModalProps) {
  const [mounted, setMounted] = useState(false);
  const [documentAction, setDocumentAction] = useState<"download" | "print" | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [documentMessage, setDocumentMessage] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!mounted) {
    return null;
  }

  const downloadPdf = async () => {
    setDocumentAction("download");
    setDocumentError("");
    setDocumentMessage("");

    try {
      const response = await fetch(`/invoices/${invoice.id}/pdf`);
      if (!response.ok) {
        throw new Error("The invoice PDF could not be prepared.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = getPdfFileName(response.headers.get("content-disposition"), invoice.invoiceNumber);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setDocumentMessage("PDF download started.");
    } catch {
      setDocumentError("PDF download failed. Please try again.");
    } finally {
      setDocumentAction(null);
    }
  };

  const printReceipt = () => {
    setDocumentAction("print");
    setDocumentError("");
    setDocumentMessage("");

    const receiptWindow = window.open(
      `/invoices/${invoice.id}/pdf?format=receipt`,
      "_blank",
      "noopener,noreferrer",
    );

    if (!receiptWindow) {
      setDocumentError("The 58mm receipt was blocked. Please allow pop-ups and try again.");
    } else {
      setDocumentMessage("58mm receipt opened in a new tab.");
    }

    setDocumentAction(null);
  };

  return createPortal(
    <div
      aria-label="Invoice"
      className="appointment-checkout-modal-backdrop appointment-invoice-modal-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-modal="true"
        className="appointment-invoice-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="appointment-invoice-header">
          <div>
            <span className="appointment-checkout-eyebrow">Checkout complete</span>
            <h2>Invoice</h2>
            <p>{formatInvoiceNumber(invoice.invoiceNumber)}</p>
          </div>
          <div className="appointment-invoice-header-actions">
            <span className={`payment-state ${invoice.status.toLowerCase()}`}>
              {formatStatus(invoice.status)}
            </span>
            <button
              aria-label="Close invoice"
              className="appointment-checkout-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <div className="appointment-invoice-meta">
          <div><span>Customer</span><strong>{invoice.customerName}</strong></div>
          <div><span>Phone</span><strong>{invoice.customerPhone}</strong></div>
          <div>
            <span>Date</span>
            <strong>{new Date(invoice.issuedAt).toLocaleDateString("en-MY")}</strong>
          </div>
        </div>

        <div className="appointment-invoice-items">
          <div className="appointment-invoice-row is-heading">
            <span>Service</span><span>Qty</span><span>Total</span>
          </div>
          {invoice.items.map((item) => (
            <div className="appointment-invoice-row" key={item.id}>
              <div><strong>{item.name}</strong><small>RM{item.unitPrice.toFixed(2)}</small></div>
              <span>{item.quantity}</span>
              <strong>RM{item.lineTotal.toFixed(2)}</strong>
            </div>
          ))}
        </div>

        <div className="appointment-invoice-totals">
          <div><span>Subtotal</span><strong>RM{invoice.subtotal.toFixed(2)}</strong></div>
          {invoice.discountAmount > 0 ? <div><span>Discount</span><strong>-RM{invoice.discountAmount.toFixed(2)}</strong></div> : null}
          {invoice.taxAmount > 0 ? <div><span>{formatTaxLabel(invoice.taxLabel, invoice.taxRate)}</span><strong>RM{invoice.taxAmount.toFixed(2)}</strong></div> : null}
          {invoice.tipAmount > 0 ? <div><span>Tip</span><strong>RM{invoice.tipAmount.toFixed(2)}</strong></div> : null}
          <div className="is-total"><span>Total</span><strong>RM{invoice.total.toFixed(2)}</strong></div>
          <div><span>Paid</span><strong>RM{invoice.paidAmount.toFixed(2)}</strong></div>
          {invoice.balance > 0 ? (
            <div className="is-balance"><span>Balance</span><strong>RM{invoice.balance.toFixed(2)}</strong></div>
          ) : null}
        </div>

        <footer className="appointment-invoice-footer">
          {documentError ? <p className="appointment-invoice-document-error">{documentError}</p> : null}
          {documentMessage ? <p className="appointment-invoice-document-message">{documentMessage}</p> : null}
          <button
            className="secondary-link-button"
            disabled={documentAction !== null}
            onClick={printReceipt}
            type="button"
          >
            {documentAction === "print" ? "Opening..." : "Print"}
          </button>
          <button
            className="secondary-link-button"
            disabled={documentAction !== null}
            onClick={downloadPdf}
            type="button"
          >
            {documentAction === "download" ? "Downloading..." : "Download PDF"}
          </button>
          <button className="button-link" onClick={onDone ?? onClose} type="button">Done</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function getPdfFileName(contentDisposition: string | null, invoiceNumber: string) {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const plainMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? `${formatInvoiceNumber(invoiceNumber)}.pdf`;
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

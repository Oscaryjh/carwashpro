"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RefundPaymentForm } from "@/components/refund-payment-form";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { VoidInvoiceForm } from "@/components/void-invoice-form";
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
  packageVoucherAmount?: number;
  cashPaidAmount?: number;
  canManagePayments?: boolean;
  canVoid?: boolean;
  voidUnavailableReason?: string | null;
  refundablePayments?: Array<{
    id: string;
    method: string;
    refundableAmount: number;
  }>;
};

export function AppointmentInvoiceModal({ invoice, onClose, onDone }: AppointmentInvoiceModalProps) {
  const [mounted, setMounted] = useState(false);
  const [documentAction, setDocumentAction] = useState<"print" | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [documentMessage, setDocumentMessage] = useState("");
  const [managementAction, setManagementAction] = useState<"refund" | "void" | null>(null);

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

  const refundablePayments = invoice.refundablePayments ?? [];
  const canRefund = Boolean(
    invoice.canManagePayments &&
    invoice.status !== "VOID" &&
    refundablePayments.length,
  );
  const showManagementActions = Boolean(
    invoice.canManagePayments && (canRefund || invoice.canVoid || invoice.voidUnavailableReason),
  );
  const packageVoucherAmount = invoice.packageVoucherAmount ?? 0;
  const cashPaidAmount = invoice.cashPaidAmount ?? invoice.paidAmount;
  const hasPackageVoucher = packageVoucherAmount > 0;
  const handleManagementComplete = () => {
    setManagementAction(null);
    (onDone ?? onClose)();
  };

  return createPortal(
    <div
      aria-label="Invoice"
      className="appointment-checkout-modal-backdrop appointment-invoice-modal-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label="Invoice"
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
            <ModalCloseButton
              ariaLabel="Close invoice"
              className="appointment-checkout-close"
              onClick={onClose}
            />
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
            <span>Item</span><span>Qty</span><span>Total</span>
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
          {hasPackageVoucher ? (
            <>
              <div><span>Package voucher</span><strong>-RM{packageVoucherAmount.toFixed(2)}</strong></div>
              {cashPaidAmount > 0 ? (
                <div><span>Other payment</span><strong>RM{cashPaidAmount.toFixed(2)}</strong></div>
              ) : null}
              <div className={invoice.balance > 0 ? "is-balance" : ""}>
                <span>Amount due</span><strong>RM{invoice.balance.toFixed(2)}</strong>
              </div>
            </>
          ) : (
            <div><span>Paid</span><strong>RM{invoice.paidAmount.toFixed(2)}</strong></div>
          )}
          {!hasPackageVoucher && invoice.balance > 0 ? (
            <div className="is-balance"><span>Balance</span><strong>RM{invoice.balance.toFixed(2)}</strong></div>
          ) : null}
        </div>

        {showManagementActions ? (
          <div className="appointment-invoice-management">
            <div className="appointment-invoice-management-tabs">
              {canRefund ? (
                <button
                  className={managementAction === "refund" ? "is-active" : ""}
                  onClick={() => setManagementAction((current) => current === "refund" ? null : "refund")}
                  type="button"
                >
                  Refund
                </button>
              ) : null}
              {invoice.canVoid ? (
                <button
                  className={managementAction === "void" ? "is-active is-danger" : "is-danger"}
                  onClick={() => setManagementAction((current) => current === "void" ? null : "void")}
                  type="button"
                >
                  Void
                </button>
              ) : null}
            </div>

            {managementAction === "refund" ? (
              <div className="appointment-invoice-management-panel">
                <div className="appointment-invoice-management-heading">
                  <div>
                    <strong>Refund payment</strong>
                    <span>A credit note will be created for every refund.</span>
                  </div>
                  <span className="status">Owner only</span>
                </div>
                <div className="refund-payment-list">
                  {refundablePayments.map((payment) => (
                    <div className="refund-payment-item" key={payment.id}>
                      <div className="refund-payment-heading">
                        <strong>{formatStatus(payment.method)} payment</strong>
                        <strong>RM{payment.refundableAmount.toFixed(2)} available</strong>
                      </div>
                      <RefundPaymentForm
                        invoiceId={invoice.id}
                        invoiceNumber={formatInvoiceNumber(invoice.invoiceNumber)}
                        onSuccess={handleManagementComplete}
                        originalMethod={payment.method}
                        paymentId={payment.id}
                        refundableAmount={payment.refundableAmount}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {managementAction === "void" && invoice.canVoid ? (
              <div className="appointment-invoice-management-panel is-danger">
                <div className="appointment-invoice-management-heading">
                  <div>
                    <strong>Void invoice</strong>
                    <span>Use this only to correct a wrongly recorded payment.</span>
                  </div>
                </div>
                <VoidInvoiceForm
                  invoiceId={invoice.id}
                  invoiceNumber={formatInvoiceNumber(invoice.invoiceNumber)}
                  onSuccess={handleManagementComplete}
                />
              </div>
            ) : null}

            {!invoice.canVoid && invoice.voidUnavailableReason ? (
              <p className="appointment-invoice-void-note">{invoice.voidUnavailableReason}</p>
            ) : null}
          </div>
        ) : null}

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
          <a
            className="secondary-link-button"
            download
            href={`/invoices/${invoice.id}/pdf`}
            onClick={() => {
              setDocumentError("");
              setDocumentMessage("PDF download started.");
            }}
          >
            Download PDF
          </a>
          <button className="button-link" onClick={onDone ?? onClose} type="button">Done</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

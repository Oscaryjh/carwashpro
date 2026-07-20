"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SalonCheckoutInvoiceSummary } from "@/app/(business)/appointments/actions";
import { AppointmentInvoiceModal } from "@/components/appointment-invoice-modal";
import type { InvoiceModalSummary } from "@/components/appointment-invoice-modal";
import { SalonAppointmentPaymentForm } from "@/components/salon-appointment-payment-form";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { TaxLineInput } from "@/lib/tax/calculator";

type CheckoutItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  type: "service" | "product" | "package";
};

type AvailableCustomerPackage = {
  id: string;
  name: string;
  remainingUses: number;
  totalUses: number;
  serviceId: string;
  serviceName: string;
};

type SalonAppointmentCheckoutModalProps = {
  appointmentId: string;
  availablePackages: AvailableCustomerPackage[];
  balance: number;
  canTakePayment: boolean;
  checkoutReady?: boolean;
  customerName: string;
  customerPhone: string;
  hasInvoice: boolean;
  hasOpenShift: boolean;
  initialOpen?: boolean;
  invoice?: InvoiceModalSummary | null;
  onDone?: () => void;
  items: CheckoutItem[];
  subtotal: number;
  totalAmount: number;
  taxLines: TaxLineInput[];
  sstEnabled: boolean;
  sstLabel: string;
  sstRate: number;
};

export function SalonAppointmentCheckoutModal({
  appointmentId,
  availablePackages,
  balance,
  canTakePayment,
  checkoutReady = true,
  customerName,
  customerPhone,
  hasInvoice,
  hasOpenShift,
  initialOpen = false,
  invoice = null,
  onDone,
  items,
  subtotal,
  totalAmount,
  taxLines,
  sstEnabled,
  sstLabel,
  sstRate,
}: SalonAppointmentCheckoutModalProps) {
  const [open, setOpen] = useState(initialOpen && canTakePayment);
  const [completedInvoice, setCompletedInvoice] = useState<SalonCheckoutInvoiceSummary | null>(
    initialOpen && invoice && !canTakePayment ? invoice : null,
  );
  const handledInitialOpenRef = useRef(initialOpen);

  const handleCheckoutComplete = useCallback((invoice: SalonCheckoutInvoiceSummary) => {
    setOpen(false);
    setCompletedInvoice(invoice);
  }, []);

  useEffect(() => {
    if (!initialOpen || handledInitialOpenRef.current) {
      return;
    }

    handledInitialOpenRef.current = true;

    if (!canTakePayment) {
      setOpen(false);
      if (invoice) {
        setCompletedInvoice(invoice);
      }
      return;
    }

    setOpen(true);
  }, [canTakePayment, initialOpen, invoice]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!canTakePayment && !invoice) {
    return null;
  }

  return (
    <>
      <button
        className="appointment-checkout-trigger"
        onClick={() => {
          if (invoice && !canTakePayment) {
            setCompletedInvoice(invoice);
            return;
          }

          setOpen(true);
        }}
        type="button"
      >
        {invoice && !canTakePayment ? "View Invoice" : "Payment & Invoice"}
      </button>

      {open ? (
        <div
          aria-label="Checkout"
          className="appointment-checkout-modal-backdrop"
          onMouseDown={() => setOpen(false)}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="appointment-checkout-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="appointment-checkout-modal-header">
              <div>
                <span className="appointment-checkout-eyebrow">Beauty &amp; Wellness checkout</span>
                <h2>Checkout</h2>
                <p>
                  {customerName} · {customerPhone}
                </p>
              </div>
              <ModalCloseButton
                ariaLabel="Close checkout"
                className="appointment-checkout-close"
                onClick={() => setOpen(false)}
              />
            </header>

            <div className="appointment-checkout-modal-body">
                <div className="appointment-checkout-services">
                  <div className="appointment-checkout-section-heading">
                    <h3>Items</h3>
                    <span>{items.reduce((sum, item) => sum + item.quantity, 0)}</span>
                  </div>
                  {items.map((item) => (
                    <div className="appointment-checkout-service-row" key={`${item.type}-${item.name}-${item.price}`}>
                      <span>
                        {item.name}
                        {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                      </span>
                      <strong>RM{(item.price * item.quantity).toFixed(2)}</strong>
                    </div>
                  ))}
                  <div className="appointment-checkout-total">
                    <span>Current total</span>
                    <strong>RM{totalAmount.toFixed(2)}</strong>
                  </div>
                </div>

                <SalonAppointmentPaymentForm
                  appointmentId={appointmentId}
                  availablePackages={availablePackages}
                  balance={balance}
                  hasInvoice={hasInvoice}
                  hasOpenShift={hasOpenShift}
                  checkoutReady={checkoutReady}
                  subtotal={subtotal}
                  totalAmount={totalAmount}
                  taxLines={taxLines}
                  checkoutItems={items}
                  sstEnabled={sstEnabled}
                  sstLabel={sstLabel}
                  sstRate={sstRate}
                  onCheckoutComplete={handleCheckoutComplete}
                />
            </div>
          </section>
        </div>
      ) : null}

      {completedInvoice ? (
        <AppointmentInvoiceModal
          invoice={completedInvoice}
          onClose={() => setCompletedInvoice(null)}
          onDone={() => {
            setCompletedInvoice(null);
            onDone?.();
          }}
        />
      ) : null}
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import styles from "./appointment-checkout-preview.module.css";

type PaymentMethod = "Cash" | "Card" | "QR Pay";

const services = [
  { name: "Haircut", detail: "45 min", price: 35 },
  { name: "Hair wash", detail: "30 min", price: 20 },
];

export function AppointmentCheckoutPreview() {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [discount, setDiscount] = useState("0");
  const [amountReceived, setAmountReceived] = useState("60");

  const subtotal = services.reduce((total, service) => total + service.price, 0);
  const discountAmount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * 0.06;
  const total = taxableAmount + tax;
  const change = Math.max((Number(amountReceived) || 0) - total, 0);
  const balance = Math.max(total - (Number(amountReceived) || 0), 0);

  const formatted = useMemo(
    () => (value: number) => `RM${value.toFixed(2)}`,
    [],
  );

  return (
    <main className={styles.page}>
      <header className={styles.previewHeader}>
        <div>
          <span className={styles.eyebrow}>UI preview only</span>
          <h1>Appointment payment flow</h1>
          <p>Click the mock Payment &amp; Invoice button to open the POS-style checkout card.</p>
        </div>
        <span className={styles.previewTag}>No real payment</span>
      </header>

      <section className={styles.stage}>
        <div className={styles.calendarShell}>
          <div className={styles.shellTopbar}>
            <strong>Appointments</strong>
            <span>17 July 2026</span>
          </div>
          <div className={styles.calendarGrid}>
            <div className={styles.timeColumn}>
              {["10:00", "10:15", "10:30", "10:45", "11:00"].map((time) => <span key={time}>{time}</span>)}
            </div>
            <div className={styles.staffColumn}>
              <div className={styles.staffHeader}>cashier A</div>
              <div className={styles.appointmentBlock}>
                <strong>OSCAR YONG</strong>
                <span>Haircut + Hair wash</span>
                <small>10:00 AM · Completed</small>
                <button className={styles.inlineAction} onClick={() => setIsCheckoutOpen(true)} type="button">
                  Payment &amp; Invoice
                </button>
              </div>
            </div>
          </div>
        </div>

        {isCheckoutOpen ? (
          <div className={styles.backdrop}>
            <section aria-label="Checkout preview" className={styles.checkoutCard}>
              <header className={styles.cardHeader}>
                <button aria-label="Close checkout" className={styles.iconButton} onClick={() => setIsCheckoutOpen(false)} type="button">×</button>
                <div>
                  <span className={styles.cardKicker}>Payment &amp; Invoice</span>
                  <h2>Checkout</h2>
                </div>
                <span className={styles.receiptIcon}>▣</span>
              </header>

              <div className={styles.cardContent}>
                <section className={styles.customerSummary}>
                  <div className={styles.avatar}>OY</div>
                  <div>
                    <strong>OSCAR YONG</strong>
                    <span>01112212259</span>
                  </div>
                  <span className={styles.status}>Completed</span>
                </section>

                <section className={styles.section}>
                  <div className={styles.sectionHeading}>
                    <h3>Service summary</h3>
                    <button className={styles.editButton} type="button">Edit</button>
                  </div>
                  <div className={styles.serviceList}>
                    {services.map((service) => (
                      <div className={styles.serviceRow} key={service.name}>
                        <span><strong>{service.name}</strong><small>{service.detail}</small></span>
                        <strong>{formatted(service.price)}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.section}>
                  <label className={styles.fieldLabel} htmlFor="preview-discount">Discount</label>
                  <div className={styles.inputWithPrefix}>
                    <span>RM</span>
                    <input id="preview-discount" min="0" onChange={(event) => setDiscount(event.target.value)} type="number" value={discount} />
                  </div>
                </section>

                <section className={styles.totals}>
                  <div><span>Subtotal</span><strong>{formatted(subtotal)}</strong></div>
                  <div><span>Discount</span><strong>- {formatted(discountAmount)}</strong></div>
                  <div><span>SST 6%</span><strong>{formatted(tax)}</strong></div>
                  <div className={styles.totalRow}><span>Total</span><strong>{formatted(total)}</strong></div>
                </section>

                <section className={styles.section}>
                  <h3>Payment method</h3>
                  <div className={styles.paymentMethods}>
                    {(["Cash", "Card", "QR Pay"] as PaymentMethod[]).map((method) => (
                      <button className={paymentMethod === method ? styles.selectedMethod : ""} key={method} onClick={() => setPaymentMethod(method)} type="button">
                        {method}
                      </button>
                    ))}
                  </div>
                  <label className={styles.fieldLabel} htmlFor="preview-received">Amount received</label>
                  <div className={styles.inputWithPrefix}>
                    <span>RM</span>
                    <input id="preview-received" min="0" onChange={(event) => setAmountReceived(event.target.value)} type="number" value={amountReceived} />
                  </div>
                </section>

                <div className={styles.balanceSummary}>
                  <span>Balance <strong>{formatted(balance)}</strong></span>
                  <span>Change <strong>{formatted(change)}</strong></span>
                </div>
              </div>

              <footer className={styles.cardFooter}>
                <button className={styles.secondaryButton} onClick={() => setIsCheckoutOpen(false)} type="button">Cancel</button>
                <button className={styles.primaryButton} type="button">Create invoice</button>
              </footer>
            </section>
          </div>
        ) : (
          <button className={styles.reopenButton} onClick={() => setIsCheckoutOpen(true)} type="button">Open Payment &amp; Invoice</button>
        )}
      </section>
    </main>
  );
}

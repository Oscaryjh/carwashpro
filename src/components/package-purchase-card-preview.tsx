"use client";

import { useState } from "react";
import styles from "./package-purchase-card-preview.module.css";

type Mode = "job" | "package";
type Screen = "sale" | "customer" | "package" | "payment";

type PackageOption = {
  id: string;
  name: string;
  price: number;
  totalUses: number;
  description: string;
};

const packageOptions: PackageOption[] = [
  {
    id: "basic-10-plus-1",
    name: "10+1 Basic Wash Package",
    price: 150,
    totalUses: 11,
    description: "Basic wash, valid at all branches",
  },
  {
    id: "premium-five",
    name: "5x Premium Wash",
    price: 100,
    totalUses: 5,
    description: "Premium wash package",
  },
  {
    id: "monthly-pass",
    name: "Monthly Wash Pass",
    price: 120,
    totalUses: 8,
    description: "Eight washes for one customer",
  },
];

const customerOptions = [
  { id: "oscar", name: "OSCAR YONG", phone: "01112212259", plate: "SAB9118G" },
  { id: "sherene", name: "SHERENE FONG", phone: "0123147628", plate: "SB1686E" },
];

function PreviewIcon({ label, tone = "blue" }: { label: string; tone?: "blue" | "teal" | "orange" }) {
  return <span className={`${styles.icon} ${styles[tone]}`}>{label}</span>;
}

export function PackagePurchaseCardPreview() {
  const [mode, setMode] = useState<Mode>("package");
  const [screen, setScreen] = useState<Screen>("sale");
  const [customerId, setCustomerId] = useState<string | null>("oscar");
  const [packageId, setPackageId] = useState<string | null>("basic-10-plus-1");
  const [query, setQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");

  const customer = customerOptions.find((item) => item.id === customerId) ?? null;
  const selectedPackage = packageOptions.find((item) => item.id === packageId) ?? null;
  const filteredCustomers = customerOptions.filter((item) => {
    const value = `${item.name} ${item.phone} ${item.plate}`.toLowerCase();
    return value.includes(query.trim().toLowerCase());
  });

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setScreen("sale");
  }

  function closePanel() {
    setScreen("sale");
    setQuery("");
  }

  return (
    <main className={styles.page}>
      <header className={styles.previewHeader}>
        <div>
          <span>UI preview only</span>
          <h1>Package-only sale</h1>
          <p>Interactive mockup. No job, payment, or package record is created.</p>
        </div>
        <div className={styles.previewLegend}>
          <strong>400px</strong>
          <span>Cashier modal width</span>
        </div>
      </header>

      <section className={styles.stage}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <button aria-label="Close preview" className={styles.closeButton} type="button">x</button>
            <h2>{mode === "package" ? "Buy Package" : "New Job"}</h2>
            <span />
          </header>

          <div className={styles.cardBody}>
            <div className={styles.modeSwitch} aria-label="Transaction type">
              <button className={mode === "job" ? styles.activeMode : ""} onClick={() => switchMode("job")} type="button">
                Create Job
              </button>
              <button className={mode === "package" ? styles.activeMode : ""} onClick={() => switchMode("package")} type="button">
                Buy Package
              </button>
            </div>

            {mode === "job" ? (
              <JobModePreview customer={customer} onSelectCustomer={() => setScreen("customer")} />
            ) : (
              <PackageModePreview
                customer={customer}
                selectedPackage={selectedPackage}
                onSelectCustomer={() => setScreen("customer")}
                onSelectPackage={() => setScreen("package")}
              />
            )}
          </div>

          <footer className={styles.cardFooter}>
            {mode === "package" ? (
              <button
                className={styles.primaryButton}
                disabled={!customer || !selectedPackage}
                onClick={() => setScreen("payment")}
                type="button"
              >
                Proceed to payment
              </button>
            ) : (
              <button className={styles.primaryButton} type="button">Confirm</button>
            )}
          </footer>

          {screen === "customer" ? (
            <div className={styles.overlay}>
              <section className={styles.picker}>
                <PickerHeader onClose={closePanel} title="Select Customer" />
                <input
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, phone, or plate"
                  value={query}
                />
                <div className={styles.pickerList}>
                  {filteredCustomers.map((item) => (
                    <button
                      className={item.id === customerId ? styles.selectedOption : ""}
                      key={item.id}
                      onClick={() => {
                        setCustomerId(item.id);
                        closePanel();
                      }}
                      type="button"
                    >
                      <PreviewIcon label={item.name.slice(0, 1)} tone="teal" />
                      <span><strong>{item.name}</strong><small>{item.phone}</small></span>
                      <span className={styles.optionMeta}><strong>{item.plate}</strong><small>Customer vehicle</small></span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {screen === "package" ? (
            <div className={styles.overlay}>
              <section className={styles.picker}>
                <PickerHeader onClose={closePanel} title="Select Package" />
                <div className={styles.pickerList}>
                  {packageOptions.map((item) => (
                    <button
                      className={item.id === packageId ? styles.selectedOption : ""}
                      key={item.id}
                      onClick={() => {
                        setPackageId(item.id);
                        closePanel();
                      }}
                      type="button"
                    >
                      <PreviewIcon label="P" tone="orange" />
                      <span><strong>{item.name}</strong><small>{item.totalUses} total uses</small></span>
                      <span className={styles.packagePrice}>RM{item.price.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {screen === "payment" && customer && selectedPackage ? (
            <div className={styles.overlay}>
              <section className={styles.paymentPanel}>
                <PickerHeader onClose={closePanel} title="Package Payment" />
                <div className={styles.paymentSummary}>
                  <span>Customer<strong>{customer.name}</strong></span>
                  <span>Package<strong>{selectedPackage.name}</strong></span>
                  <span>Package uses<strong>{selectedPackage.totalUses}</strong></span>
                  <span className={styles.totalRow}>Total<strong>RM{selectedPackage.price.toFixed(2)}</strong></span>
                </div>
                <h3>Payment method</h3>
                <div className={styles.paymentMethods}>
                  {[
                    ["CASH", "Cash"],
                    ["CARD", "Card"],
                    ["TRANSFER", "Transfer"],
                  ].map(([value, label]) => (
                    <button
                      className={paymentMethod === value ? styles.activePayment : ""}
                      key={value}
                      onClick={() => setPaymentMethod(value)}
                      type="button"
                    >
                      <span />{label}
                    </button>
                  ))}
                </div>
                <p>Full payment activates all {selectedPackage.totalUses} package uses.</p>
                <button className={styles.payButton} type="button">Pay RM{selectedPackage.price.toFixed(2)}</button>
              </section>
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}

function PickerHeader({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <header className={styles.pickerHeader}>
      <button aria-label="Close" onClick={onClose} type="button">x</button>
      <h3>{title}</h3>
      <span />
    </header>
  );
}

function PackageModePreview({
  customer,
  selectedPackage,
  onSelectCustomer,
  onSelectPackage,
}: {
  customer: (typeof customerOptions)[number] | null;
  selectedPackage: PackageOption | null;
  onSelectCustomer: () => void;
  onSelectPackage: () => void;
}) {
  return (
    <div className={styles.flowContent}>
      <section className={styles.sectionBlock}>
        <h3>Customer</h3>
        <button className={styles.selectionRow} onClick={onSelectCustomer} type="button">
          <PreviewIcon label="C" />
          {customer ? (
            <span><strong>{customer.name}</strong><small>{customer.phone}</small></span>
          ) : (
            <span><strong>Select customer</strong><small>Search by name, phone, or plate</small></span>
          )}
          <b>Search</b>
        </button>
      </section>

      <section className={styles.sectionBlock}>
        <h3>Package</h3>
        <button className={styles.selectionRow} disabled={!customer} onClick={onSelectPackage} type="button">
          <PreviewIcon label="P" tone="orange" />
          {selectedPackage ? (
            <span><strong>{selectedPackage.name}</strong><small>{selectedPackage.description}</small></span>
          ) : (
            <span><strong>Select package</strong><small>{customer ? "Choose an active package" : "Select a customer first"}</small></span>
          )}
          <b>Choose</b>
        </button>
      </section>

      {selectedPackage ? (
        <section className={styles.packageSummary}>
          <div><span>Package uses</span><strong>{selectedPackage.totalUses}</strong></div>
          <div><span>Purchase price</span><strong>RM{selectedPackage.price.toFixed(2)}</strong></div>
          <p>This is a package-only sale. No job will be created.</p>
        </section>
      ) : null}
    </div>
  );
}

function JobModePreview({
  customer,
  onSelectCustomer,
}: {
  customer: (typeof customerOptions)[number] | null;
  onSelectCustomer: () => void;
}) {
  return (
    <div className={styles.flowContent}>
      <button className={styles.selectionRow} onClick={onSelectCustomer} type="button">
        <PreviewIcon label="C" />
        <span><strong>{customer?.name ?? "Select customer or vehicle"}</strong><small>{customer?.plate ?? "Search by name, phone, or plate"}</small></span>
        <b>Search</b>
      </button>
      <section className={styles.sectionBlock}>
        <h3>Pick up contact</h3>
        <div className={styles.contactModes}>
          <button className={styles.activeContact} type="button"><strong>Registered owner</strong><small>Use customer phone</small></button>
          <button type="button"><strong>Other person</strong><small>Pickup contact</small></button>
        </div>
      </section>
      <button className={styles.serviceRow} type="button"><PreviewIcon label="+" /><strong>Select Service</strong><span>Choose</span></button>
      <label className={styles.notesField}><span>Notes optional</span><textarea rows={3} /></label>
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  PackageCustomerPicker,
  type PackageCustomerOption,
} from "@/components/package-customer-picker";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

export type WorkOrderPackageOption = {
  description: string | null;
  id: string;
  name: string;
  price: number;
  totalUses: number;
};

type WorkOrderPackagePurchaseProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  packages: WorkOrderPackageOption[];
};

const paymentMethods = [
  { label: "Cash", value: "CASH" },
  { label: "Card", value: "CARD" },
  { label: "DuitNow", value: "DUITNOW" },
  { label: "E-wallet", value: "EWALLET" },
  { label: "Transfer", value: "BANK_TRANSFER" },
] as const;

export function WorkOrderPackagePurchase({
  action,
  branches,
  packages,
}: WorkOrderPackagePurchaseProps) {
  const [selectedCustomer, setSelectedCustomer] =
    useState<PackageCustomerOption | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [isPackagePickerOpen, setIsPackagePickerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [step, setStep] = useState<"details" | "payment">("details");
  const selectedPackage =
    packages.find((packageOption) => packageOption.id === selectedPackageId) ?? null;
  const canContinue = Boolean(selectedCustomer && selectedPackage);

  return (
    <form action={action} className="package-purchase-form">
      {step === "details" ? (
        <div className="package-purchase-flow">
          <section className="package-purchase-section">
            <h3>Customer account</h3>
            <PackageCustomerPicker onSelectionChange={setSelectedCustomer} />
          </section>

          <section className="package-purchase-section">
            <h3>Package</h3>
            <button
              className="package-purchase-selection"
              disabled={!selectedCustomer || !packages.length}
              onClick={() => setIsPackagePickerOpen(true)}
              type="button"
            >
              <span aria-hidden="true">P</span>
              <div>
                <strong>{selectedPackage?.name ?? "Select package"}</strong>
                <small>
                  {selectedPackage
                    ? selectedPackage.description || "Active customer package"
                    : selectedCustomer
                      ? packages.length
                        ? "Choose an active package"
                        : "No active packages available"
                      : "Select a customer first"}
                </small>
              </div>
              <b>Choose</b>
            </button>
          </section>

          {selectedPackage ? (
            <section className="package-purchase-summary">
              <div>
                <span>Package uses</span>
                <strong>{selectedPackage.totalUses}</strong>
              </div>
              <div>
                <span>Purchase price</span>
                <strong>{formatMoney(selectedPackage.price)}</strong>
              </div>
              <p>This sale activates the package only. No job will be created.</p>
            </section>
          ) : null}

          <div className="package-purchase-actions">
            <button
              disabled={!canContinue}
              onClick={() => setStep("payment")}
              type="button"
            >
              Proceed to payment
            </button>
          </div>
        </div>
      ) : selectedCustomer && selectedPackage ? (
        <div className="package-payment-flow">
          <section className="package-payment-summary">
            <div>
              <span>Customer</span>
              <strong>{selectedCustomer.name}</strong>
              <small>{selectedCustomer.phone}</small>
            </div>
            <div>
              <span>Package</span>
              <strong>{selectedPackage.name}</strong>
              <small>{selectedPackage.totalUses} total uses</small>
            </div>
            <div className="package-payment-total">
              <span>Total</span>
              <strong>{formatMoney(selectedPackage.price)}</strong>
            </div>
          </section>

          <section className="package-payment-method-section">
            <h3>Payment method</h3>
            <div className="package-payment-methods">
              {paymentMethods.map((method) => (
                <label
                  className={paymentMethod === method.value ? "is-selected" : ""}
                  key={method.value}
                >
                  <input
                    checked={paymentMethod === method.value}
                    name="method"
                    onChange={() => setPaymentMethod(method.value)}
                    type="radio"
                    value={method.value}
                  />
                  <span aria-hidden="true" />
                  <strong>{method.label}</strong>
                </label>
              ))}
            </div>
          </section>

          {paymentMethod !== "CASH" ? (
            <label className="package-payment-reference">
              <span>Payment reference</span>
              <input
                autoComplete="off"
                maxLength={120}
                name="reference"
                placeholder="Enter transaction reference"
                required
              />
            </label>
          ) : null}

          <BranchSelect branches={branches} />
          <input name="customerId" type="hidden" value={selectedCustomer.id} />
          <input name="packageId" type="hidden" value={selectedPackage.id} />

          <p className="package-payment-note">
            Full payment activates all {selectedPackage.totalUses} uses for the
            customer account {selectedCustomer.phone}.
          </p>

          <div className="package-payment-actions">
            <button onClick={() => setStep("details")} type="button">
              Back
            </button>
            <button type="submit">Pay {formatMoney(selectedPackage.price)}</button>
          </div>
        </div>
      ) : null}

      {isPackagePickerOpen ? (
        <div className="package-picker-backdrop" role="presentation">
          <section aria-labelledby="package-picker-title" className="package-picker" role="dialog">
            <header>
              <button
                aria-label="Close package picker"
                onClick={() => setIsPackagePickerOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h3 id="package-picker-title">Select Package</h3>
              <span />
            </header>
            <div className="package-picker-list">
              {packages.map((packageOption) => (
                <button
                  className={packageOption.id === selectedPackageId ? "is-selected" : ""}
                  key={packageOption.id}
                  onClick={() => {
                    setSelectedPackageId(packageOption.id);
                    setIsPackagePickerOpen(false);
                  }}
                  type="button"
                >
                  <span aria-hidden="true">P</span>
                  <div>
                    <strong>{packageOption.name}</strong>
                    <small>{packageOption.totalUses} total uses</small>
                  </div>
                  <b>{formatMoney(packageOption.price)}</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </form>
  );
}

function formatMoney(value: number) {
  return `RM${value.toFixed(2)}`;
}

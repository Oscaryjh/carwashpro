"use client";

import { useState } from "react";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

export type AppointmentPackageOption = {
  description: string | null;
  id: string;
  name: string;
  price: number;
  totalUses: number;
};

type AppointmentPackagePurchaseFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  customerId: string;
  customerName: string;
  customerPhone: string;
  packages: AppointmentPackageOption[];
  returnTo: string;
};

const paymentMethods = [
  { label: "Cash", value: "CASH" },
  { label: "Card", value: "CARD" },
  { label: "DuitNow", value: "DUITNOW" },
  { label: "E-wallet", value: "EWALLET" },
  { label: "Transfer", value: "BANK_TRANSFER" },
] as const;

export function AppointmentPackagePurchaseForm({
  action,
  branches,
  customerId,
  customerName,
  customerPhone,
  packages,
  returnTo,
}: AppointmentPackagePurchaseFormProps) {
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const selectedPackage = packages.find((item) => item.id === selectedPackageId);

  if (!packages.length) {
    return <p className="empty-state">No active packages are available for sale.</p>;
  }

  return (
    <form action={action} className="appointment-package-form">
      <input name="customerId" type="hidden" value={customerId} />
      <input name="packageId" type="hidden" value={selectedPackageId} />
      <input name="returnTo" type="hidden" value={returnTo} />

      <div className="appointment-package-customer">
        <span>Customer</span>
        <strong>{customerName}</strong>
        <small>{customerPhone}</small>
      </div>

      <label className="appointment-package-select">
        <span>Select package</span>
        <select
          required
          value={selectedPackageId}
          onChange={(event) => setSelectedPackageId(event.target.value)}
        >
          <option value="">Choose an active package</option>
          {packages.map((packagePlan) => (
            <option key={packagePlan.id} value={packagePlan.id}>
              {packagePlan.name} - RM{packagePlan.price.toFixed(2)}
            </option>
          ))}
        </select>
      </label>

      {selectedPackage ? (
        <div className="appointment-package-summary">
          <div>
            <span>Package uses</span>
            <strong>{selectedPackage.totalUses}</strong>
          </div>
          <div>
            <span>Purchase price</span>
            <strong>RM{selectedPackage.price.toFixed(2)}</strong>
          </div>
          <p>{selectedPackage.description || "Full payment activates the package for this customer."}</p>
        </div>
      ) : null}

      <BranchSelect branches={branches} />

      <fieldset className="appointment-package-payment-methods">
        <legend>Payment method</legend>
        <div>
          {paymentMethods.map((method) => (
            <label className={paymentMethod === method.value ? "is-selected" : ""} key={method.value}>
              <input
                checked={paymentMethod === method.value}
                name="method"
                onChange={() => setPaymentMethod(method.value)}
                type="radio"
                value={method.value}
              />
              <span>{method.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {paymentMethod !== "CASH" ? (
        <label className="appointment-package-reference">
          <span>Payment reference</span>
          <input name="reference" placeholder="Enter transaction reference" required />
        </label>
      ) : null}

      <button disabled={!selectedPackage} type="submit">
        {selectedPackage ? `Pay RM${selectedPackage.price.toFixed(2)}` : "Select a package"}
      </button>
    </form>
  );
}

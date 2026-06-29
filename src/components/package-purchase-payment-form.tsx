"use client";

import { useState } from "react";

type PackagePurchasePaymentFormProps = {
  action: (formData: FormData) => Promise<void>;
  customerPackageId: string;
  balance: number;
};

export function PackagePurchasePaymentForm({
  action,
  customerPackageId,
  balance,
}: PackagePurchasePaymentFormProps) {
  const [method, setMethod] = useState("CASH");
  const isReferenceRequired = method !== "CASH";

  return (
    <form action={action} className="form">
      <input type="hidden" name="customerPackageId" value={customerPackageId} />
      <div className="field-grid">
        <label>
          <span>Payment amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min={balance.toFixed(2)}
            max={balance.toFixed(2)}
            defaultValue={balance.toFixed(2)}
            required
          />
        </label>
        <label>
          <span>Payment method</span>
          <select
            name="method"
            defaultValue="CASH"
            onChange={(event) => setMethod(event.target.value)}
            required
          >
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="DUITNOW">DuitNow</option>
            <option value="EWALLET">E-wallet</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </label>
        <label>
          <span>{isReferenceRequired ? "Reference required" : "Reference optional"}</span>
          <input name="reference" required={isReferenceRequired} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit">Pay and activate package</button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";

type BusinessTaxFieldsProps = {
  initialEnabled: boolean;
  initialLabel: string;
  initialRate: string;
  initialRegistrationNo: string;
};

export function BusinessTaxFields({
  initialEnabled,
  initialLabel,
  initialRate,
  initialRegistrationNo,
}: BusinessTaxFieldsProps) {
  const [sstEnabled, setSstEnabled] = useState(initialEnabled);

  return (
    <div className="business-tax-fields">
      <label className="business-tax-status-field">
        <span>Tax status</span>
        <span className="business-tax-toggle">
          <span className="business-tax-toggle-copy">
            {sstEnabled ? "SST enabled" : "Enable SST"}
          </span>
          <input
            checked={sstEnabled}
            name="sstEnabled"
            onChange={(event) => setSstEnabled(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="business-tax-switch" />
        </span>
      </label>
      <label>
        <span>Tax label</span>
        <input
          aria-required={sstEnabled}
          name="sstLabel"
          defaultValue={initialLabel}
          required={sstEnabled}
        />
      </label>
      <label>
        <span>Tax rate (%)</span>
        <input
          aria-required={sstEnabled}
          defaultValue={initialRate}
          max="100"
          min="0"
          name="sstRate"
          required={sstEnabled}
          step="0.01"
          type="number"
        />
      </label>
      <label>
        <span>SST registration no.{sstEnabled ? " *" : " optional"}</span>
        <input
          aria-required={sstEnabled}
          defaultValue={initialRegistrationNo}
          name="sstRegistrationNo"
          placeholder="Registration number"
          required={sstEnabled}
        />
      </label>
    </div>
  );
}

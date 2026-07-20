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
    <div className="field-grid">
      <label className="checkbox-row">
        <input
          checked={sstEnabled}
          name="sstEnabled"
          onChange={(event) => setSstEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>Enable SST</span>
      </label>
      <label>
        <span>Tax label</span>
        <input name="sstLabel" defaultValue={initialLabel} />
      </label>
      <label>
        <span>Tax rate (%)</span>
        <input
          defaultValue={initialRate}
          max="100"
          min="0"
          name="sstRate"
          step="0.01"
          type="number"
        />
      </label>
      <label>
        <span>SST registration no.{sstEnabled ? "" : " optional"}</span>
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

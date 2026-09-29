"use client";

import { useState } from "react";

type ServiceTaxFieldsProps = {
  defaultTaxable: boolean;
  defaultTaxRate: string;
  companySstRate?: number | null;
  compact?: boolean;
};

export function ServiceTaxFields({ defaultTaxable, defaultTaxRate, companySstRate, compact = false }: ServiceTaxFieldsProps) {
  const [taxable, setTaxable] = useState(defaultTaxable);
  const [showHiddenRateError, setShowHiddenRateError] = useState(false);
  const hasCompanyRate = typeof companySstRate === "number" &&
    Number.isFinite(companySstRate) && companySstRate >= 0 && companySstRate <= 100;

  return (
    <div className={compact ? "service-tax-fields service-tax-fields-inline" : "service-tax-fields"}>
      <label className="service-taxable-field">
        <input name="taxable" type="checkbox" checked={taxable}
          onChange={(event) => {
            setTaxable(event.currentTarget.checked);
            setShowHiddenRateError(false);
          }} />
        <span className="service-taxable-indicator" aria-hidden="true">✓</span>
        {compact ? <span className="service-taxable-state" aria-hidden="true">{taxable ? "On" : "Off"}</span> : null}
        <span className="service-taxable-copy">
          <strong>Taxable service</strong>
          <small>Include SST when this service is selected.</small>
        </span>
      </label>
      {showHiddenRateError && !taxable ? (
        <small className="form-error" role="alert">
          The tax rate is invalid. Turn on Taxable service to correct or clear it before saving.
        </small>
      ) : null}
      {/* Keep the input mounted and enabled so hiding it does not erase or change its submitted value. */}
      <div className={compact ? "service-tax-rate-slot" : undefined}>
      <div hidden={!taxable}>
        <label className="service-tax-rate-field">
          <span>Tax rate</span>
          <div className="input-with-suffix">
            <input name="taxRate" type="number" step="0.01" min="0" max="100"
              placeholder={hasCompanyRate ? `Use company rate: ${companySstRate}%` : "Use company SST rate"}
              defaultValue={defaultTaxRate}
              onInvalid={(event) => {
                if (!taxable) {
                  event.preventDefault();
                  setShowHiddenRateError(true);
                }
              }} />
            <span>%</span>
          </div>
          <small className="field-helper">
            {hasCompanyRate
              ? "Optional. Enter a different rate only for this service."
              : "Leave blank to use the company SST rate."}
          </small>
        </label>
      </div>
      </div>
    </div>
  );
}

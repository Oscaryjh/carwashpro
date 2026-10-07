"use client";

import { useEffect, useId, useState } from "react";
import { formatCents, parseMoneyToCents } from "@/lib/commercial/money";
import { PackageServiceDropdown } from "@/components/package-service-dropdown";

type ServiceOption = {
  id: string;
  name: string;
  categoryName: string;
  price?: string;
};

type BenefitValue = {
  serviceId: string;
  totalUses: number;
};

type BenefitRow = { serviceId: string; totalUses: string; key: number; showError: boolean };

function includedUses(raw: string) {
  if (raw.trim() === "") return Number.NaN;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : Number.NaN;
}

export function PackageServiceBenefitsField({
  services,
  initialBenefits = [],
  createMode = false,
  onBenefitsChange,
}: {
  services: ServiceOption[];
  initialBenefits?: BenefitValue[];
  createMode?: boolean;
  onBenefitsChange?: (benefits: BenefitValue[]) => void;
}) {
  const id = useId();
  const [nextKey, setNextKey] = useState(Math.max(initialBenefits.length, 1) + 1);
  const [rows, setRows] = useState<BenefitRow[]>(() =>
    (initialBenefits.length ? initialBenefits : [{ serviceId: "", totalUses: 1 }]).map(
      (benefit, index) => ({
        ...benefit, key: index + 1, totalUses: String(benefit.totalUses),
        showError: !Number.isFinite(includedUses(String(benefit.totalUses))),
      }),
    ),
  );
  useEffect(() => { onBenefitsChange?.(rows.map(({ serviceId, totalUses }) => ({ serviceId, totalUses: includedUses(totalUses) }))); }, [rows, onBenefitsChange]);
  const selectedIds = new Set(rows.map((row) => row.serviceId).filter(Boolean));
  const validServiceIds = new Set(services.map((service) => service.id));
  const canAddRow = !createMode || validServiceIds.has(rows[rows.length - 1]?.serviceId);
  const groups = Array.from(
    services.reduce((result, service) => {
      const items = result.get(service.categoryName) ?? [];
      items.push(service);
      result.set(service.categoryName, items);
      return result;
    }, new Map<string, ServiceOption[]>()),
  ).sort(([left], [right]) => left.localeCompare(right));

  function addRow() {
    if (!canAddRow) return;
    setRows((current) => [
      ...current,
      { key: nextKey, serviceId: "", totalUses: "1", showError: false },
    ]);
    setNextKey((current) => current + 1);
  }

  function updateRow(key: number, patch: Partial<Omit<BenefitRow, "key">>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <fieldset className="package-benefits-fieldset">
      <div className="package-benefits-header">
        <div>
          <legend>Included services</legend>
          <p>{createMode ? "Choose the services included in this package and the uses included for each." : "Set the number of uses included for each service."}</p>
        </div>
        {!createMode ? <button className="button-secondary" type="button" onClick={addRow}>
          + Add service
        </button> : null}
      </div>

      <div className="package-benefit-columns" aria-hidden="true"><span>Service</span><span>Included uses</span>{!createMode ? <span>Value</span> : null}<span>{!createMode ? "Remove" : null}</span></div>
      <div className="package-benefit-list">
        {rows.map((row, index) => {
          const quantity = includedUses(row.totalUses);
          const invalid = !Number.isFinite(quantity);
          const errorId = `${id}-uses-error-${row.key}`;
          return (
          <div className="package-benefit-row" key={row.key}>
            <div className="package-service-field">
              {createMode ? <span className="sr-only">Service {index + 1}</span> : null}
              <PackageServiceDropdown
                name="benefitServiceId"
                value={row.serviceId}
                label={`Service ${index + 1}`}
                onChange={serviceId => updateRow(row.key, { serviceId })}
                required
                groups={groups.map(([category, items]) => [category, items.map(service => ({
                  ...service, disabled: selectedIds.has(service.id) && row.serviceId !== service.id,
                }))])}
              />
              {createMode && row.serviceId ? <small className="package-service-value">{(() => {
                const service = services.find(item => item.id === row.serviceId);
                const cents = service?.price === undefined ? null : parseMoneyToCents(service.price);
                const total = cents !== null && !invalid ? cents * quantity : null;
                return cents !== null && total !== null && Number.isSafeInteger(total)
                  ? `${formatCents(cents)} × ${row.totalUses} = ${formatCents(total)}` : "Price unavailable";
              })()}</small> : null}
            </div>
            <div className="package-quantity-field">
              <span className="sr-only">Included uses</span>
              <div className="package-quantity-control" role="group" aria-label={`Included uses for service ${index + 1}`}>
              <button type="button" aria-label="Decrease included uses"
                disabled={invalid || quantity <= 1}
                onClick={() => updateRow(row.key, { totalUses: String(quantity - 1) })}>−</button>
              <input
                name="benefitTotalUses"
                aria-label={`Included uses for service ${index + 1}`}
                aria-invalid={row.showError && invalid || undefined}
                aria-describedby={row.showError && invalid ? errorId : undefined}
                type="number"
                inputMode="numeric"
                min="1"
                max="999"
                step="1"
                value={row.totalUses}
                onFocus={event => event.currentTarget.select()}
                onBlur={() => updateRow(row.key, { showError: true })}
                onInvalid={() => updateRow(row.key, { showError: true })}
                onChange={(event) =>
                  updateRow(row.key, { totalUses: event.target.value })
                }
                required
              />
              <button type="button" aria-label="Increase included uses"
                disabled={invalid || quantity >= 999}
                onClick={() => updateRow(row.key, { totalUses: String(quantity + 1) })}>+</button>
              </div>
              {row.showError && invalid ? <span className="field-error package-quantity-error" role="alert" id={errorId}>
                Enter a whole number from 1 to 999.
              </span> : null}
            </div>
            {!createMode ? <output className="package-benefit-value" aria-label={`Value for service ${index + 1}`}>{(() => {
              const service = services.find(item => item.id === row.serviceId);
              const cents = service?.price === undefined ? null : parseMoneyToCents(service.price);
              const total = cents !== null && !invalid ? cents * quantity : null;
              return total !== null && Number.isSafeInteger(total) ? formatCents(total) : "Price unavailable";
            })()}</output> : null}
            {!createMode || rows.length > 1 ? <button
              aria-label={`Remove service ${index + 1}`}
              className="package-benefit-remove"
              type="button"
              onClick={() => removeRow(row.key)}
              disabled={rows.length === 1}
              title="Remove service"
            >
              ×
            </button> : null}
          </div>
        );})}
      </div>
      {createMode ? <div className="package-benefit-add">
        <button className="button-secondary" type="button" onClick={addRow} disabled={!canAddRow}>+ Add service</button>
        {!canAddRow ? <small>Select a service before adding another.</small> : null}
      </div> : null}
      {createMode ? <p className="package-benefits-summary">
        {createMode ? `Total Uses: ${rows.reduce((sum, row) => sum + (validServiceIds.has(row.serviceId) ? includedUses(row.totalUses) || 0 : 0), 0)}` : `Total Uses: ${rows.reduce((sum, row) => sum + (includedUses(row.totalUses) || 0), 0)}`}
      </p> : null}
    </fieldset>
  );
}

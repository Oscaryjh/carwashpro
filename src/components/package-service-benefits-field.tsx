"use client";

import { useState } from "react";

type ServiceOption = {
  id: string;
  name: string;
  categoryName: string;
};

type BenefitValue = {
  serviceId: string;
  totalUses: number;
};

type BenefitRow = BenefitValue & { key: number };

export function PackageServiceBenefitsField({
  services,
  initialBenefits = [],
}: {
  services: ServiceOption[];
  initialBenefits?: BenefitValue[];
}) {
  const [nextKey, setNextKey] = useState(Math.max(initialBenefits.length, 1) + 1);
  const [rows, setRows] = useState<BenefitRow[]>(() =>
    (initialBenefits.length ? initialBenefits : [{ serviceId: "", totalUses: 1 }]).map(
      (benefit, index) => ({ ...benefit, key: index + 1 }),
    ),
  );
  const selectedIds = new Set(rows.map((row) => row.serviceId).filter(Boolean));
  const groups = Array.from(
    services.reduce((result, service) => {
      const items = result.get(service.categoryName) ?? [];
      items.push(service);
      result.set(service.categoryName, items);
      return result;
    }, new Map<string, ServiceOption[]>()),
  ).sort(([left], [right]) => left.localeCompare(right));

  function addRow() {
    setRows((current) => [
      ...current,
      { key: nextKey, serviceId: "", totalUses: 1 },
    ]);
    setNextKey((current) => current + 1);
  }

  function updateRow(key: number, patch: Partial<BenefitValue>) {
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
          <p>Set the number of uses included for each service.</p>
        </div>
        <button className="button-secondary" type="button" onClick={addRow}>
          + Add service
        </button>
      </div>

      <div className="package-benefit-list">
        {rows.map((row, index) => (
          <div className="package-benefit-row" key={row.key}>
            <label>
              <span>Service {index + 1}</span>
              <select
                name="benefitServiceId"
                value={row.serviceId}
                onChange={(event) =>
                  updateRow(row.key, { serviceId: event.target.value })
                }
                required
              >
                <option value="" disabled>
                  Select service
                </option>
                {groups.map(([categoryName, categoryServices]) => (
                  <optgroup key={categoryName} label={categoryName}>
                    {categoryServices.map((service) => (
                      <option
                        key={service.id}
                        value={service.id}
                        disabled={selectedIds.has(service.id) && row.serviceId !== service.id}
                      >
                        {service.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              <span>Uses</span>
              <input
                name="benefitTotalUses"
                type="number"
                min="1"
                max="999"
                step="1"
                value={row.totalUses}
                onChange={(event) =>
                  updateRow(row.key, { totalUses: Number(event.target.value) })
                }
                required
              />
            </label>
            <button
              aria-label={`Remove service ${index + 1}`}
              className="package-benefit-remove"
              type="button"
              onClick={() => removeRow(row.key)}
              disabled={rows.length === 1}
              title="Remove service"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <p className="package-benefits-summary">
        Total {rows.reduce((sum, row) => sum + (Number(row.totalUses) || 0), 0)} uses
      </p>
    </fieldset>
  );
}

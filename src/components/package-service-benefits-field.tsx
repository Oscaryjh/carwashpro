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
  createMode = false,
}: {
  services: ServiceOption[];
  initialBenefits?: BenefitValue[];
  createMode?: boolean;
}) {
  const [nextKey, setNextKey] = useState(Math.max(initialBenefits.length, 1) + 1);
  const [rows, setRows] = useState<BenefitRow[]>(() =>
    (initialBenefits.length ? initialBenefits : [{ serviceId: "", totalUses: 1 }]).map(
      (benefit, index) => ({ ...benefit, key: index + 1 }),
    ),
  );
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
          <p>{createMode ? "Choose the services included in this package and how many times each can be redeemed." : "Set the number of uses included for each service."}</p>
        </div>
        {!createMode ? <button className="button-secondary" type="button" onClick={addRow}>
          + Add service
        </button> : null}
      </div>

      {createMode ? <div className="package-benefit-columns" aria-hidden="true"><span>Service</span><span>Included uses</span><span /></div> : null}
      <div className="package-benefit-list">
        {rows.map((row, index) => (
          <div className="package-benefit-row" key={row.key}>
            <label>
              <span className={createMode ? "sr-only" : undefined}>Service {index + 1}</span>
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
              <span className={createMode ? "sr-only" : undefined}>{createMode ? `Included uses for service ${index + 1}` : "Uses"}</span>
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
        ))}
      </div>
      {createMode ? <div className="package-benefit-add">
        <button className="button-secondary" type="button" onClick={addRow} disabled={!canAddRow}>+ Add service</button>
        {!canAddRow ? <small>Select a service before adding another.</small> : null}
      </div> : null}
      <p className="package-benefits-summary">
        {createMode ? `Total included uses: ${rows.reduce((sum, row) => sum + (validServiceIds.has(row.serviceId) ? Number(row.totalUses) || 0 : 0), 0)}` : `Total ${rows.reduce((sum, row) => sum + (Number(row.totalUses) || 0), 0)} uses`}
      </p>
    </fieldset>
  );
}

"use client";

import { useMemo, useState } from "react";

type CustomerPackageOption = {
  id: string;
  name: string;
  price: number;
  totalUses: number;
};

type CustomerPackageSelectorProps = {
  packages: CustomerPackageOption[];
};

export function CustomerPackageSelector({
  packages,
}: CustomerPackageSelectorProps) {
  const [query, setQuery] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");

  const filteredPackages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return packages;
    }

    return packages.filter((packagePlan) =>
      packagePlan.name.toLowerCase().includes(normalizedQuery),
    );
  }, [packages, query]);

  return (
    <div className="customer-package-selector">
      {packages.length > 4 ? (
        <div className="customer-package-filter-row">
          <input
            aria-label="Search package"
            placeholder="Search package"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="customer-package-count">
            {filteredPackages.length}/{packages.length}
          </span>
        </div>
      ) : null}

      {filteredPackages.length ? (
        <div className="customer-package-option-grid is-scrollable">
          {filteredPackages.map((packagePlan) => (
            <label
              className="customer-package-option"
              key={packagePlan.id}
              data-selected={selectedPackageId === packagePlan.id}
            >
              <input
                checked={selectedPackageId === packagePlan.id}
                name="packageId"
                onChange={() => setSelectedPackageId(packagePlan.id)}
                required
                type="radio"
                value={packagePlan.id}
              />
              <span>{packagePlan.name}</span>
              <strong>RM{packagePlan.price.toFixed(2)}</strong>
              <small>{packagePlan.totalUses} uses</small>
            </label>
          ))}
        </div>
      ) : (
        <p className="empty-state">No package matches this search.</p>
      )}

      <div className="form-actions">
        <button disabled={!selectedPackageId} type="submit">
          Continue to payment
        </button>
      </div>
    </div>
  );
}

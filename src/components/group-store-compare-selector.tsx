"use client";

import React, { useState } from "react";
import {
  GROUP_STORE_COMPARISON_MAX,
  GROUP_STORE_COMPARISON_MIN,
} from "@/lib/business-groups/group-store-comparison";

type ComparisonCandidate = {
  id: string;
  name: string;
  rank: number;
  netSalesCents: number;
  coverage: "FULL" | "PARTIAL" | "NONE";
  isHistorical: boolean;
};

type ComparisonFilters = {
  range: string;
  from: string | null;
  to: string | null;
  paymentMethod: string | null;
  status: string | null;
};

export function GroupStoreCompareSelector({
  action,
  candidates,
  filters,
  initialSelectedIds,
  selectionError,
}: {
  action: string;
  candidates: ComparisonCandidate[];
  filters: ComparisonFilters;
  initialSelectedIds: string[];
  selectionError: string | null;
}) {
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [hasEdited, setHasEdited] = useState(false);
  const selectedSet = new Set(selectedIds);
  const isValid =
    selectedIds.length >= GROUP_STORE_COMPARISON_MIN &&
    selectedIds.length <= GROUP_STORE_COMPARISON_MAX;
  const visibleError = hasEdited ? null : selectionError;

  function toggleStore(businessId: string) {
    setHasEdited(true);
    setSelectedIds((current) => {
      if (current.includes(businessId)) {
        return current.filter((id) => id !== businessId);
      }
      if (current.length >= GROUP_STORE_COMPARISON_MAX) return current;
      return [...current, businessId];
    });
  }

  return (
    <form action={action} className="group-store-compare-form" method="get">
      <input name="range" type="hidden" value={filters.range} />
      {filters.from ? (
        <input name="from" type="hidden" value={filters.from} />
      ) : null}
      {filters.to ? <input name="to" type="hidden" value={filters.to} /> : null}
      <input name="store" type="hidden" value="all" />
      <input
        name="paymentMethod"
        type="hidden"
        value={filters.paymentMethod ?? "all"}
      />
      <input name="status" type="hidden" value={filters.status ?? "all"} />
      <input name="page" type="hidden" value="1" />

      <fieldset>
        <legend>Choose stores</legend>
        <p id="group-store-compare-help">
          Select {GROUP_STORE_COMPARISON_MIN}–{GROUP_STORE_COMPARISON_MAX} stores.
          The same report filters and business-day rules apply to every store.
        </p>
        <div className="group-store-compare-options">
          {candidates.map((candidate) => {
            const checked = selectedSet.has(candidate.id);
            const disabled =
              candidate.coverage === "NONE" ||
              candidate.isHistorical ||
              (!checked && selectedIds.length >= GROUP_STORE_COMPARISON_MAX);
            return (
              <label
                className="group-store-compare-option"
                data-coverage={candidate.coverage.toLowerCase()}
                data-disabled={disabled ? "true" : "false"}
                data-selected={checked ? "true" : "false"}
                key={candidate.id}
              >
                <input
                  aria-describedby="group-store-compare-help"
                  checked={checked}
                  disabled={disabled}
                  name="compareStore"
                  onChange={() => toggleStore(candidate.id)}
                  type="checkbox"
                  value={candidate.id}
                />
                <span>
                  <strong>{candidate.name}</strong>
                  <small>
                    #{candidate.rank}
                    {candidate.coverage === "NONE"
                      ? " · No membership in this period"
                      : candidate.isHistorical
                        ? " · Historical store · report only"
                      : ` · ${formatMoney(candidate.netSalesCents)}${
                          candidate.coverage === "PARTIAL"
                            ? " · Partial period"
                            : ""
                        }`}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="group-store-compare-actions">
        <p
          aria-live="polite"
          className={isValid ? "is-valid" : ""}
          role={visibleError ? "alert" : undefined}
        >
          {visibleError ??
            (selectedIds.length === GROUP_STORE_COMPARISON_MAX
              ? `Maximum ${GROUP_STORE_COMPARISON_MAX} selected · deselect one to replace it`
              : `${selectedIds.length} selected · choose ${GROUP_STORE_COMPARISON_MIN} to ${GROUP_STORE_COMPARISON_MAX}`)}
        </p>
        <button disabled={!isValid} type="submit">
          Compare selected
        </button>
      </div>
    </form>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

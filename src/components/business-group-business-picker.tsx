"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type {
  BusinessGroupActionState,
  addBusinessToGroupAction,
} from "@/app/admin/business-groups/actions";

type EligibleBusiness = {
  id: string;
  name: string;
  slug: string;
  companyNo: string | null;
  industryLabel: string;
};

type BusinessGroupBusinessPickerProps = {
  action: typeof addBusinessToGroupAction;
  businesses: EligibleBusiness[];
  groupId: string;
};

const initialState: BusinessGroupActionState = {
  status: "idle",
  message: "",
};

export function BusinessGroupBusinessPicker({
  action,
  businesses,
  groupId,
}: BusinessGroupBusinessPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [state, formAction, pending] = useActionState(action, initialState);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const filteredBusinesses = useMemo(() => {
    if (!normalizedQuery) return businesses;

    return businesses.filter((business) =>
      [
        business.name,
        business.slug,
        business.companyNo ?? "",
        business.industryLabel,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [businesses, normalizedQuery]);

  useEffect(() => {
    if (state.status !== "success") return;
    setQuery("");
    setSelectedBusinessId("");
  }, [state.status]);

  return (
    <form action={formAction} className="business-group-picker" aria-busy={pending}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="businessId" value={selectedBusinessId} />

      <div className="business-group-picker-toolbar">
        <label>
          <span>Find a business</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, slug, company no. or industry"
            autoComplete="off"
          />
        </label>
        <div className="business-group-picker-count" aria-live="polite">
          {filteredBusinesses.length} of {businesses.length}
        </div>
      </div>

      <div
        className="business-group-picker-results"
        role="radiogroup"
        aria-label="Eligible businesses"
      >
        {filteredBusinesses.length ? (
          filteredBusinesses.map((business) => {
            const selected = selectedBusinessId === business.id;
            return (
              <label
                className={`business-group-picker-option${selected ? " is-selected" : ""}`}
                key={business.id}
              >
                <input
                  type="radio"
                  name="businessPicker"
                  value={business.id}
                  checked={selected}
                  onChange={() => setSelectedBusinessId(business.id)}
                />
                <span>
                  <strong>{business.name}</strong>
                  <small>
                    {business.industryLabel}
                    {business.companyNo ? ` - ${business.companyNo}` : ""}
                    {` - ${business.slug}`}
                  </small>
                </span>
              </label>
            );
          })
        ) : (
          <p className="business-group-picker-empty">
            No eligible businesses match this search.
          </p>
        )}
      </div>

      <div className="business-group-picker-actions">
        <span className="muted">
          {selectedBusinessId ? "1 business selected" : "Select one business to continue"}
        </span>
        <button type="submit" disabled={!selectedBusinessId || pending}>
          {pending ? "Adding..." : "Add business"}
        </button>
      </div>

      {state.status === "error" ? (
        <p className="form-message error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="form-message success" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

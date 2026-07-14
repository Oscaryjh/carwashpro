"use client";

import { useEffect, useRef, useState } from "react";

export type PackageCustomerOption = {
  id: string;
  name: string;
  phone: string;
  vehicleCount: number;
  vehicles: Array<{
    brand: string | null;
    model: string | null;
    plateNumber: string;
  }>;
};

type PackageCustomerPickerProps = {
  onSelectionChange?: (customer: PackageCustomerOption | null) => void;
};

type CustomerSearchResponse = {
  customers?: PackageCustomerOption[];
  error?: string;
};

export function PackageCustomerPicker({
  onSelectionChange,
}: PackageCustomerPickerProps) {
  const requestSequence = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PackageCustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] =
    useState<PackageCustomerOption | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/customers/search?q=${encodeURIComponent(query.trim())}`,
          { cache: "no-store" },
        );
        const responseText = await response.text();
        const payload = responseText
          ? (JSON.parse(responseText) as CustomerSearchResponse)
          : {};

        if (!response.ok) {
          throw new Error(payload.error || "Unable to search customers.");
        }

        if (sequence === requestSequence.current) {
          setResults(payload.customers ?? []);
        }
      } catch (searchError) {
        if (sequence === requestSequence.current) {
          setResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "Unable to search customers.",
          );
        }
      } finally {
        if (sequence === requestSequence.current) {
          setIsLoading(false);
        }
      }
    }, query.trim() ? 180 : 0);

    return () => window.clearTimeout(timer);
  }, [isOpen, query]);

  function chooseCustomer(customer: PackageCustomerOption) {
    setSelectedCustomer(customer);
    setIsOpen(false);
    setQuery("");
    onSelectionChange?.(customer);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    onSelectionChange?.(null);
  }

  return (
    <>
      <input
        name="customerId"
        type="hidden"
        value={selectedCustomer?.id ?? ""}
      />
      <button
        className="package-purchase-selection package-customer-selection"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true">C</span>
        <div>
          <strong>{selectedCustomer?.name ?? "Select customer"}</strong>
          <small>
            {selectedCustomer
              ? selectedCustomer.phone
              : "Search by phone, name, or plate"}
          </small>
        </div>
        <b>{selectedCustomer ? "Change" : "Choose"}</b>
      </button>
      {selectedCustomer ? (
        <div className="package-customer-account-note">
          <span>
            Package account: {selectedCustomer.phone}. Usable by all vehicles under
            this customer.
          </span>
          <button onClick={clearCustomer} type="button">
            Clear
          </button>
        </div>
      ) : null}

      {isOpen ? (
        <div className="member-picker-backdrop" role="presentation">
          <section
            aria-labelledby="package-customer-picker-title"
            className="member-picker package-customer-picker"
            role="dialog"
          >
            <header className="member-picker-header">
              <button
                aria-label="Close customer picker"
                className="member-picker-close"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="package-customer-picker-title">Customer account</h2>
              <span className="member-picker-header-spacer" />
            </header>

            <label className="member-picker-search">
              <span aria-hidden="true">S</span>
              <input
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Phone, name, or plate"
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear customer search"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  {"\u00d7"}
                </button>
              ) : (
                <span />
              )}
            </label>

            <p className="package-customer-picker-help">
              Packages belong to the customer phone account, not one vehicle.
            </p>

            <div className="package-customer-results">
              {isLoading ? (
                <p className="package-customer-state">Searching customers...</p>
              ) : error ? (
                <p className="package-customer-state is-error">{error}</p>
              ) : results.length ? (
                results.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => chooseCustomer(customer)}
                    type="button"
                  >
                    <span aria-hidden="true">{getInitials(customer.name)}</span>
                    <div>
                      <strong>{customer.name}</strong>
                      <small>{customer.phone}</small>
                      <em>{formatVehicleSummary(customer)}</em>
                    </div>
                    <b>
                      {customer.vehicleCount} vehicle
                      {customer.vehicleCount === 1 ? "" : "s"}
                    </b>
                  </button>
                ))
              ) : (
                <p className="package-customer-state">No matching customer found.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
}

function formatVehicleSummary(customer: PackageCustomerOption) {
  if (!customer.vehicles.length) {
    return "No vehicle registered";
  }

  const plates = customer.vehicles.map((vehicle) => vehicle.plateNumber).join(", ");
  const remaining = customer.vehicleCount - customer.vehicles.length;

  return remaining > 0 ? `${plates} +${remaining}` : plates;
}

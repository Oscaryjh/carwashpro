"use client";

import { useEffect, useRef, useState } from "react";

export type PackageCustomerOption = {
  activePackageCount?: number;
  id: string;
  loyaltyPoints?: number;
  loyaltyStatus?: string | null;
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
  buttonClassName?: string;
  compactAccountNote?: boolean;
  includeVehicleDetails?: boolean;
  onSelectionChange?: (customer: PackageCustomerOption | null) => void;
  posDisplay?: boolean;
  required?: boolean;
};

type CustomerSearchResponse = {
  customers?: PackageCustomerOption[];
  error?: string;
};

export function PackageCustomerPicker({
  buttonClassName,
  compactAccountNote = false,
  includeVehicleDetails = true,
  onSelectionChange,
  posDisplay = false,
  required = false,
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
        className={`package-purchase-selection package-customer-selection ${buttonClassName ?? ""}`.trim()}
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true">{selectedCustomer ? getInitials(selectedCustomer.name) : "C"}</span>
        <div>
          <strong>{selectedCustomer?.name ?? (required ? "Select customer" : "Walk-in customer")}</strong>
          <small>
            {selectedCustomer
              ? `${selectedCustomer.phone}${posDisplay && selectedCustomer.loyaltyStatus === "ACTIVE" ? " · Loyalty member" : ""}`
              : includeVehicleDetails
                ? "Search by phone, name, or plate"
                : required
                  ? "Required for package purchase"
                  : "Optional for product sales"}
          </small>
        </div>
        {posDisplay && selectedCustomer ? (
          <span className="package-customer-pos-meta">
            <strong>{selectedCustomer.loyaltyPoints ?? 0} pts</strong>
            <small>{selectedCustomer.activePackageCount ?? 0} active packages</small>
          </span>
        ) : (
          <b>{selectedCustomer ? "Change" : "Choose"}</b>
        )}
      </button>
      {selectedCustomer && !compactAccountNote ? (
        <div className="package-customer-account-note">
          <span>
            Package account: {selectedCustomer.phone}.{" "}
            {includeVehicleDetails
              ? "Usable by all vehicles under this customer."
              : "Usable for this customer."}
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
                placeholder={
                  includeVehicleDetails
                    ? "Phone, name, or plate"
                    : "Phone or customer name"
                }
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
              {includeVehicleDetails
                ? "Packages belong to the customer phone account, not one vehicle."
                : "Packages belong to the customer phone account."}
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
                      {includeVehicleDetails ? (
                        <em>{formatVehicleSummary(customer)}</em>
                      ) : null}
                    </div>
                    {includeVehicleDetails ? (
                      <b>
                        {customer.vehicleCount} vehicle
                        {customer.vehicleCount === 1 ? "" : "s"}
                      </b>
                    ) : null}
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

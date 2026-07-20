"use client";

import { useEffect, useRef, useState, type Ref } from "react";

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
  buttonRef?: Ref<HTMLButtonElement>;
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

type CustomerCreateResponse = {
  customer?: PackageCustomerOption;
  error?: string;
};

export function PackageCustomerPicker({
  buttonRef,
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
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [createPhone, setCreatePhone] = useState("");
  const [createName, setCreateName] = useState("");
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
    setIsCreating(false);
    setCreatePhone("");
    setCreateName("");
    setError("");
    onSelectionChange?.(customer);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    onSelectionChange?.(null);
  }

  function showCreateCustomer() {
    const searchValue = query.trim();
    setIsCreating(true);
    setError("");
    if (/^[0-9+\-\s()]+$/.test(searchValue)) {
      setCreatePhone(searchValue.replace(/[^0-9]/g, ""));
    } else if (searchValue) {
      setCreateName(searchValue);
    }
  }

  async function createCustomer() {
    if (isCreatingCustomer) return;

    setIsCreatingCustomer(true);
    setError("");

    try {
      const response = await fetch("/api/appointments/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName, phone: createPhone }),
      });
      const responseText = await response.text();
      const payload = responseText
        ? (JSON.parse(responseText) as CustomerCreateResponse)
        : {};

      if (!response.ok || !payload.customer) {
        throw new Error(payload.error || "Unable to create customer.");
      }

      chooseCustomer(payload.customer);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create customer.",
      );
    } finally {
      setIsCreatingCustomer(false);
    }
  }

  return (
    <>
      <input
        name="customerId"
        type="hidden"
        value={selectedCustomer?.id ?? ""}
      />
      <button
        ref={buttonRef}
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
              <button
                aria-label={isCreating ? "Back to customer search" : "Add new customer"}
                className="member-picker-add"
                onClick={() => {
                  if (isCreating) {
                    setIsCreating(false);
                    setError("");
                    return;
                  }
                  showCreateCustomer();
                }}
                type="button"
              >
                {isCreating ? "\u2190" : "+"}
              </button>
            </header>

            <label className="member-picker-search">
              <span aria-hidden="true" className="member-picker-search-icon" />
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
              {isCreating
                ? "Create a customer, then continue with this sale."
                : query.trim()
                  ? "Showing up to 20 matching customers."
                  : "Recent customers. Search by phone or customer name."}
            </p>

            {isCreating ? (
              <div className="member-picker-create-card package-customer-create-card">
                <div className="package-customer-create-heading">
                  <span aria-hidden="true">C</span>
                  <div>
                    <h3>New customer</h3>
                    <p>The phone number identifies this customer account.</p>
                  </div>
                </div>
                <div className="member-picker-create-grid">
                  <label>
                    <span>Phone</span>
                    <input
                      autoFocus
                      inputMode="tel"
                      onChange={(event) => setCreatePhone(event.target.value)}
                      placeholder="Phone number"
                      value={createPhone}
                    />
                  </label>
                  <label>
                    <span>Name</span>
                    <input
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="Customer name"
                      value={createName}
                    />
                  </label>
                </div>
                {error ? <p className="member-picker-create-error">{error}</p> : null}
                <div className="package-customer-create-actions">
                  <button
                    className="package-customer-create-cancel"
                    disabled={isCreatingCustomer}
                    onClick={() => {
                      setIsCreating(false);
                      setError("");
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="member-picker-create-submit"
                    disabled={isCreatingCustomer}
                    onClick={() => void createCustomer()}
                    type="button"
                  >
                    {isCreatingCustomer ? "Creating..." : "Create customer"}
                  </button>
                </div>
              </div>
            ) : null}

            {!isCreating ? <div className="package-customer-results">
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
                <div className="package-customer-empty">
                  <p className="package-customer-state">No matching customer found.</p>
                  <button
                    className="member-picker-empty-action"
                    onClick={showCreateCustomer}
                    type="button"
                  >
                    + Add customer
                  </button>
                </div>
              )}
            </div> : null}
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

"use client";

import { useEffect, useRef, useState } from "react";

type AppointmentCustomer = {
  id: string;
  name: string;
  phone: string;
};

type AppointmentCustomerPickerProps = {
  onSelectionChange?: (customer: AppointmentCustomer | null) => void;
};

export function AppointmentCustomerPicker({
  onSelectionChange,
}: AppointmentCustomerPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<AppointmentCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<AppointmentCustomer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const requiredRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requiredRef.current?.setCustomValidity(selectedCustomer ? "" : "Choose a customer.");
  }, [selectedCustomer]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || query.trim().length < 2) {
      setCustomers([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const data = response.ok
          ? ((await response.json()) as { customers?: AppointmentCustomer[] })
          : null;
        setCustomers(data?.customers ?? []);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          console.error(requestError);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, query]);

  function chooseCustomer(customer: AppointmentCustomer) {
    setSelectedCustomer(customer);
    onSelectionChange?.(customer);
    setIsOpen(false);
    setQuery("");
    setCustomers([]);
    setIsCreating(false);
    setError("");
  }

  async function createCustomer() {
    setError("");
    const response = await fetch("/api/appointments/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: createName, phone: createPhone }),
    });
    const data = (await response.json()) as { customer?: AppointmentCustomer; error?: string };

    if (!response.ok || !data.customer) {
      setError(data.error ?? "Unable to create customer.");
      return;
    }

    chooseCustomer(data.customer);
  }

  return (
    <div className="vehicle-picker salon-customer-picker">
      <span>Customer</span>
      <input name="customerId" type="hidden" value={selectedCustomer?.id ?? ""} />
      <div className="vehicle-picker-input-row" onClick={() => setIsOpen(true)}>
        <span aria-hidden="true" className="appointment-picker-icon appointment-customer-icon">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 12.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Zm0-6.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8ZM4.1 20.2c.4-3.2 3.7-5.3 7.9-5.3s7.5 2.1 7.9 5.3c.1.5-.3.9-.8.9H4.9c-.5 0-.9-.4-.8-.9Zm2.1-.9h11.6c-.8-1.3-2.9-2.6-5.8-2.6s-5 1.3-5.8 2.6Z" />
          </svg>
        </span>
        <input
          aria-readonly="true"
          onFocus={() => setIsOpen(true)}
          onInvalid={(event) => {
            event.preventDefault();
            setIsOpen(true);
          }}
          placeholder="Select customer"
          readOnly
          ref={requiredRef}
          required
          type="text"
          value={selectedCustomer ? `${selectedCustomer.name} - ${selectedCustomer.phone}` : ""}
        />
        <button aria-label="Search customer" onClick={() => setIsOpen(true)} type="button">
          {"\u2315"}
        </button>
      </div>
      <small>Search by customer name or phone.</small>

      {isOpen ? (
        <div className="member-picker-backdrop" role="presentation">
          <section aria-modal="true" className="member-picker salon-member-picker" role="dialog">
            <div className="member-picker-header">
              <button aria-label="Close customer search" className="member-picker-close" onClick={() => setIsOpen(false)} type="button">
                {"\u00d7"}
              </button>
              <h2>Customer</h2>
              <span className="member-picker-header-spacer" />
            </div>
            <div className="member-picker-search">
              <span aria-hidden="true">{"\u2315"}</span>
              <input
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or phone"
                ref={searchRef}
                value={query}
              />
              {query ? <button aria-label="Clear search" onClick={() => setQuery("")} type="button">{"\u00d7"}</button> : null}
            </div>

            {isLoading ? <p className="member-picker-help">Searching...</p> : null}
            {!isLoading && query.trim().length >= 2 && customers.length === 0 ? (
              <div className="member-picker-empty">
                <p className="member-picker-help">No matching customer.</p>
                <button className="member-picker-empty-action" onClick={() => {
                  setIsCreating(true);
                  if (/^[0-9+\-\s()]+$/.test(query.trim())) setCreatePhone(query.trim());
                  else setCreateName(query.trim());
                }} type="button">
                  + Add customer
                </button>
              </div>
            ) : null}

            {isCreating ? (
              <div className="member-picker-create-card">
                <h3>New Customer</h3>
                <div className="member-picker-create-grid">
                  <label><span>Phone</span><input inputMode="tel" onChange={(event) => setCreatePhone(event.target.value)} placeholder="Phone number" value={createPhone} /></label>
                  <label><span>Name</span><input onChange={(event) => setCreateName(event.target.value)} placeholder="Customer name" value={createName} /></label>
                </div>
                {error ? <p className="member-picker-create-error">{error}</p> : null}
                <button className="member-picker-create-submit" onClick={() => void createCustomer()} type="button">Create customer</button>
              </div>
            ) : null}

            {customers.length ? (
              <div className="member-picker-results salon-customer-results">
                {customers.map((customer) => (
                  <button key={customer.id} onClick={() => chooseCustomer(customer)} type="button">
                    <span className="vehicle-picker-avatar" aria-hidden="true">{initials(customer.name)}</span>
                    <div><strong>{customer.name}</strong><span>{customer.phone}</span></div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

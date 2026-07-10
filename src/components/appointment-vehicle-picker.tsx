"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VehicleSelectFields } from "@/components/vehicle-select-fields";

export type AppointmentVehicleOption = {
  brand: string | null;
  color: string | null;
  id: string;
  label: string;
  model: string | null;
  plateNumber: string;
  customerName: string;
  customerPhone: string;
};

type AppointmentVehiclePickerProps = {
  initialVehicles?: AppointmentVehicleOption[];
};

type CreateCustomerDraft = {
  name: string;
  phone: string;
  plateNumber: string;
  brand: string;
  model: string;
  color: string;
};

type ExistingCustomerMatch = {
  name: string;
  phone: string;
};

export function AppointmentVehiclePicker({}: AppointmentVehiclePickerProps) {
  const [query, setQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [isMemberOpen, setIsMemberOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createCustomer, setCreateCustomer] = useState<CreateCustomerDraft>({
    name: "",
    phone: "",
    plateNumber: "",
    brand: "",
    model: "",
    color: "",
  });
  const [selectedVehicle, setSelectedVehicle] =
    useState<AppointmentVehicleOption | null>(null);
  const [vehicles, setVehicles] = useState<AppointmentVehicleOption[]>([]);
  const [existingCustomerMatch, setExistingCustomerMatch] =
    useState<ExistingCustomerMatch | null>(null);
  const [isSearchingVehicles, setIsSearchingVehicles] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trimmedMemberQuery = memberQuery.trim();

  const helperText = useMemo(() => {
    if (selectedVehicle) {
      return "";
    }

    if (isMemberOpen && trimmedMemberQuery) {
      if (trimmedMemberQuery.length < 2) {
        return "Type at least 2 characters.";
      }

      if (isSearchingVehicles) {
        return "";
      }

      return vehicles.length ? "Choose one vehicle from the results." : "No matching vehicle.";
    }

    return "Tap to search by plate, customer name, or phone.";
  }, [isMemberOpen, isSearchingVehicles, selectedVehicle, trimmedMemberQuery, vehicles.length]);

  function openMemberSearch() {
    setMemberQuery(selectedVehicle ? selectedVehicle.customerName : query);
    setVehicles([]);
    setIsSearchingVehicles(false);
    setIsCreateOpen(false);
    setCreateError("");
    setIsMemberOpen(true);
  }

  function openCreateCustomer() {
    setIsSearchingVehicles(false);
    setCreateCustomer(buildCreateCustomerDraft(memberQuery));
    setExistingCustomerMatch(null);
    setCreateError("");
    setIsCreateOpen(true);
  }

  async function createCustomerFromPicker() {
    setCreateError("");

    try {
      const response = await fetch("/api/appointments/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createCustomer),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        vehicle?: AppointmentVehicleOption;
      }>(response);

      if (!data) {
        setCreateError("Unable to read customer search response. Please refresh the page.");
        return;
      }

      if (!response.ok || !data.vehicle) {
        setCreateError(data.error ?? "Unable to create customer.");
        return;
      }

      setSelectedVehicle(data.vehicle);
      setQuery(data.vehicle.label);
      setMemberQuery(data.vehicle.label);
      setVehicles([]);
      setExistingCustomerMatch(null);
      setIsCreateOpen(false);
      setIsMemberOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create customer.");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const trimmedQuery = memberQuery.trim();
    let didStartRequest = false;

    if (!isMemberOpen) {
      setIsSearchingVehicles(false);
      return undefined;
    }

    if (selectedVehicle && memberQuery === selectedVehicle.label) {
      setIsSearchingVehicles(false);
      return () => safeAbort(controller, "vehicle selection unchanged");
    }

    if (trimmedQuery.length < 2) {
      setVehicles([]);
      setIsSearchingVehicles(false);
      return () => safeAbort(controller, "vehicle query too short");
    }

    setIsSearchingVehicles(true);

    const timer = window.setTimeout(() => {
      async function searchVehicles() {
        didStartRequest = true;
        const params = new URLSearchParams();

        if (trimmedQuery) {
          params.set("q", trimmedQuery);
        }

        try {
          const response = await fetch(`/api/appointments/vehicles?${params.toString()}`, {
            signal: controller.signal,
          });

          if (!response.ok) {
            return;
          }

          const data = await readJsonResponse<{ vehicles: AppointmentVehicleOption[] }>(response);
          setVehicles(data?.vehicles ?? []);
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          console.error(error);
        } finally {
          if (!controller.signal.aborted) {
            setIsSearchingVehicles(false);
          }
        }
      }

      void searchVehicles();
    }, 220);

    return () => {
      if (didStartRequest && !controller.signal.aborted) {
        safeAbort(controller, "vehicle search changed");
      }
      window.clearTimeout(timer);
    };
  }, [isMemberOpen, memberQuery, selectedVehicle]);

  useEffect(() => {
    searchInputRef.current?.setCustomValidity(
      selectedVehicle ? "" : "Choose a vehicle from the search results.",
    );
  }, [selectedVehicle]);

  useEffect(() => {
    if (!isCreateOpen) {
      return;
    }

    setCreateCustomer((current) => syncCreateCustomerDraft(memberQuery, current));
  }, [isCreateOpen, memberQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const phone = createCustomer.phone.trim();

    if (!isCreateOpen || phone.replace(/[^\d]/g, "").length < 7) {
      setExistingCustomerMatch(null);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: phone });
        const response = await fetch(`/api/appointments/vehicles?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          setExistingCustomerMatch(null);
          return;
        }

        const data = await readJsonResponse<{ vehicles: AppointmentVehicleOption[] }>(response);
        const vehicles = data?.vehicles ?? [];
        const normalizedPhone = normalizePhoneForCompare(phone);
        const match = vehicles.find(
          (vehicle) => normalizePhoneForCompare(vehicle.customerPhone) === normalizedPhone,
        );
        const existingMatch = match
          ? { name: match.customerName, phone: match.customerPhone }
          : null;

        setExistingCustomerMatch(existingMatch);
        if (existingMatch) {
          setCreateCustomer((current) => ({
            ...current,
            name: existingMatch.name,
          }));
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.error(error);
        setExistingCustomerMatch(null);
      }
    }, 220);

    return () => {
      safeAbort(controller, "customer phone lookup changed");
      window.clearTimeout(timer);
    };
  }, [createCustomer.phone, isCreateOpen]);

  return (
    <label className="vehicle-picker">
      <span>Phone number or plate</span>
      <input type="hidden" name="vehicleId" value={selectedVehicle?.id ?? ""} />
      <div className="vehicle-picker-input-row" onClick={openMemberSearch}>
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M6.6 10.8c1.4 2.7 3.9 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 13.2 3 3.8c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1l-2.2 2.1Z" />
          </svg>
        </span>
        <input
          autoComplete="off"
          aria-readonly="true"
          onFocus={openMemberSearch}
          onInvalid={(event) => {
            event.preventDefault();
            openMemberSearch();
          }}
          onChange={() => {
            openMemberSearch();
          }}
          placeholder="Select customer or vehicle"
          ref={searchInputRef}
          required
          type="search"
          value={selectedVehicle ? formatSelectedVehicleLabel(selectedVehicle) : ""}
        />
        <button
          aria-label="Search member"
          onClick={(event) => {
            event.stopPropagation();
            openMemberSearch();
          }}
          type="button"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="m20.3 19-4.1-4.1a7 7 0 1 0-1.4 1.4l4.1 4.1a1 1 0 0 0 1.4-1.4ZM5 10.8a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z" />
          </svg>
        </button>
      </div>
      {helperText ? <small>{helperText}</small> : null}

      {isMemberOpen ? (
        <div className="member-picker-backdrop" role="presentation">
          <section
            aria-labelledby="member-picker-title"
            aria-modal="true"
            className="member-picker"
            role="dialog"
          >
            <div className="member-picker-header">
              <button
                aria-label="Close member search"
                className="member-picker-close"
                onClick={() => setIsMemberOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="member-picker-title">Customer</h2>
              <span aria-hidden="true" className="member-picker-header-spacer" />
            </div>

            <div className="member-picker-search">
              <span aria-hidden="true">{"\u2315"}</span>
              <input
                autoComplete="off"
                autoFocus
                onChange={(event) => setMemberQuery(uppercaseLatinLetters(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }

                  event.preventDefault();

                  if (trimmedMemberQuery && !vehicles.length) {
                    openCreateCustomer();
                  }
                }}
                placeholder="Search"
                type="text"
                value={memberQuery}
              />
              {memberQuery ? (
                <button
                  aria-label="Clear search"
                  onClick={() => {
                    setMemberQuery("");
                    setVehicles([]);
                    setIsSearchingVehicles(false);
                  }}
                  type="button"
                >
                  {"\u00d7"}
                </button>
              ) : null}
            </div>

            <div className="member-picker-status">
              {isSearchingVehicles ? <p className="member-picker-help">Searching...</p> : null}
              {!isSearchingVehicles && trimmedMemberQuery.length >= 2 && !vehicles.length ? (
                <div className="member-picker-empty">
                  <p className="member-picker-help">No matching customer or vehicle.</p>
                  <button
                    className="member-picker-empty-action"
                    onClick={openCreateCustomer}
                    type="button"
                  >
                    + Add customer
                  </button>
                </div>
              ) : null}
            </div>

            {isCreateOpen ? (
              <div className="member-picker-create-card">
                {existingCustomerMatch ? (
                  <p className="member-picker-create-match">
                    Existing customer found: <strong>{existingCustomerMatch.name}</strong>{" "}
                    ({existingCustomerMatch.phone}). This plate will be added to that customer.
                  </p>
                ) : null}
                <h3>New Customer</h3>
                <div className="member-picker-create-grid">
                  <label>
                    <span>Phone</span>
                    <input
                      autoComplete="off"
                      inputMode="tel"
                      onChange={(event) =>
                        setCreateCustomer((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      placeholder="Phone number"
                      type="text"
                      value={createCustomer.phone}
                    />
                  </label>
                  <label>
                    <span>Name</span>
                    <input
                      autoComplete="off"
                      onChange={(event) =>
                        setCreateCustomer((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Customer name"
                      type="text"
                      value={createCustomer.name}
                    />
                  </label>
                  <label>
                    <span>Plate number</span>
                    <input
                      autoComplete="off"
                      onChange={(event) =>
                        setCreateCustomer((current) => ({
                          ...current,
                          plateNumber: event.target.value,
                        }))
                      }
                      placeholder="Plate number"
                      type="text"
                      value={createCustomer.plateNumber}
                    />
                  </label>
                  <VehicleSelectFields
                    compact
                    defaultBrand={createCustomer.brand}
                    defaultColor={createCustomer.color}
                    defaultModel={createCustomer.model}
                    onChange={(values) =>
                      setCreateCustomer((current) => ({ ...current, ...values }))
                    }
                  />
                </div>
                {createError ? <p className="member-picker-create-error">{createError}</p> : null}
                {!existingCustomerMatch ? (
                  <p className="member-picker-create-note">
                    If the phone already exists, this will add the vehicle to that customer.
                  </p>
                ) : null}
                <button
                  className="member-picker-create-submit"
                  onClick={createCustomerFromPicker}
                  type="button"
                >
                  {existingCustomerMatch ? "Add vehicle to customer" : "Create customer / Add vehicle"}
                </button>
              </div>
            ) : null}

            {vehicles.length ? (
              <div className="vehicle-picker-results member-picker-results">
                {vehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    onClick={() => {
                      setSelectedVehicle(vehicle);
                      setQuery(vehicle.label);
                      setMemberQuery(vehicle.label);
                      setVehicles([]);
                      setIsSearchingVehicles(false);
                      setIsMemberOpen(false);
                    }}
                    type="button"
                  >
                    <span className="vehicle-picker-avatar" aria-hidden="true">
                      {getInitials(vehicle.customerName)}
                    </span>
                    <div className="vehicle-picker-result-customer">
                      <strong>{vehicle.customerName}</strong>
                      <span>{vehicle.customerPhone}</span>
                    </div>
                    <div className="vehicle-picker-result-main">
                      <strong>{vehicle.plateNumber}</strong>
                      <span>{formatVehicleDescription(vehicle)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </label>
  );
}

function formatVehicleDescription(vehicle: AppointmentVehicleOption) {
  return [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") || "No vehicle details";
}

function formatSelectedVehicleLabel(vehicle: AppointmentVehicleOption) {
  return `${vehicle.customerName} - ${vehicle.plateNumber}`;
}

function safeAbort(controller: AbortController, reason: string) {
  if (controller.signal.aborted) {
    return;
  }

  try {
    controller.abort(new DOMException(reason, "AbortError"));
  } catch {
    controller.abort();
  }
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  return (await response.json()) as T;
}

function normalizePhoneForCompare(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");

  if (digits.startsWith("60") && digits.length > 9) {
    return `0${digits.slice(2)}`;
  }

  if (digits.startsWith("1") && digits.length >= 8) {
    return `0${digits}`;
  }

  return digits;
}

function uppercaseLatinLetters(value: string) {
  return value.replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

function buildCreateCustomerDraft(query: string): CreateCustomerDraft {
  const trimmedQuery = query.trim();
  const draft = {
    name: "",
    phone: "",
    plateNumber: "",
    brand: "",
    model: "",
    color: "",
  };

  if (/^[0-9+\-\s()]+$/.test(trimmedQuery)) {
    draft.phone = trimmedQuery;
  } else if (/^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z0-9\s-]+$/.test(trimmedQuery)) {
    draft.plateNumber = trimmedQuery.toUpperCase();
  } else if (trimmedQuery) {
    draft.name = trimmedQuery;
  }

  return draft;
}

function syncCreateCustomerDraft(query: string, current: CreateCustomerDraft) {
  const trimmedQuery = query.trim();
  const next = buildCreateCustomerDraft(query);

  if (!trimmedQuery) {
    if (!current.name && !current.phone && !current.plateNumber) {
      return current;
    }

    return { ...current, name: "", phone: "", plateNumber: "" };
  }

  if (next.plateNumber && current.plateNumber !== next.plateNumber) {
    return { ...current, name: "", phone: "", plateNumber: next.plateNumber };
  }

  if (next.phone && current.phone !== next.phone) {
    return { ...current, name: "", phone: next.phone, plateNumber: "" };
  }

  if (next.name && current.name !== next.name) {
    return { ...current, name: next.name, phone: "", plateNumber: "" };
  }

  return current;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

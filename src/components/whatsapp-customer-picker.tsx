"use client";

import { useMemo, useState } from "react";
import {
  linkWhatsAppConversationToCustomerAction,
  openCrmCustomerWhatsAppAction,
} from "@/app/(business)/whatsapp/inbox/actions";

type WhatsAppCustomerPickerCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  vehicles: Array<{
    plateNumber: string;
    brand: string | null;
    model: string | null;
    color: string | null;
  }>;
};

type WhatsAppCustomerPickerProps = {
  buttonLabel?: string;
  conversationId?: string;
  customers: WhatsAppCustomerPickerCustomer[];
  includeVehicleDetails?: boolean;
  title?: string;
};

export function WhatsAppCustomerPicker({
  buttonLabel,
  conversationId,
  customers,
  includeVehicleDetails = true,
  title = "CRM Customers",
}: WhatsAppCustomerPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return customers.slice(0, 40);
    }

    return customers
      .filter((customer) => {
        const searchable = [
          customer.name,
          customer.phone,
          customer.email ?? "",
          ...(includeVehicleDetails
            ? customer.vehicles.flatMap((vehicle) => [
                vehicle.plateNumber,
                vehicle.brand ?? "",
                vehicle.model ?? "",
                vehicle.color ?? "",
              ])
            : []),
        ]
          .join(" ")
          .toLowerCase();

        return searchable.includes(normalizedQuery);
      })
      .slice(0, 40);
  }, [customers, includeVehicleDetails, query]);

  return (
    <>
      <button
        aria-label={buttonLabel ?? "Find CRM customer"}
        className={buttonLabel ? "secondary-light-button compact-link-button" : "whatsapp-new-chat-button"}
        onClick={() => setIsOpen(true)}
        title={buttonLabel ?? "Find CRM customer"}
        type="button"
      >
        {buttonLabel ? buttonLabel : <span aria-hidden="true">+</span>}
      </button>

      {isOpen ? (
        <div className="whatsapp-customer-picker-backdrop" role="presentation">
          <div
            aria-labelledby="whatsapp-customer-picker-title"
            aria-modal="true"
            className="whatsapp-customer-picker"
            role="dialog"
          >
            <div className="whatsapp-customer-picker-header">
              <button
                aria-label="Close customer picker"
                className="whatsapp-picker-close"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                <span aria-hidden="true">x</span>
              </button>
              <h2 id="whatsapp-customer-picker-title">{title}</h2>
            </div>

            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                includeVehicleDetails
                  ? "Search customer, phone, email, or plate"
                  : "Search customer, phone, or email"
              }
              type="search"
              value={query}
            />

            <div className="whatsapp-customer-picker-list">
              {filteredCustomers.length ? (
                filteredCustomers.map((customer) => (
                  <form
                    action={
                      conversationId
                        ? linkWhatsAppConversationToCustomerAction
                        : openCrmCustomerWhatsAppAction
                    }
                    key={customer.id}
                  >
                    {conversationId ? (
                      <input
                        name="conversationId"
                        type="hidden"
                        value={conversationId}
                      />
                    ) : null}
                    <input name="customerId" type="hidden" value={customer.id} />
                    <button className="whatsapp-customer-picker-row" type="submit">
                      <span className="whatsapp-avatar" aria-hidden="true">
                        {getInitials(customer.name)}
                      </span>
                      <span>
                        <strong>{customer.name}</strong>
                        <small>{customer.phone}</small>
                        {includeVehicleDetails && customer.vehicles[0] ? (
                          <small>
                            {[
                              customer.vehicles[0].plateNumber,
                              customer.vehicles[0].brand,
                              customer.vehicles[0].model,
                            ]
                              .filter(Boolean)
                              .join(" - ")}
                          </small>
                        ) : null}
                      </span>
                    </button>
                  </form>
                ))
              ) : (
                <p className="empty-state">No CRM customer found.</p>
              )}
            </div>
          </div>
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
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

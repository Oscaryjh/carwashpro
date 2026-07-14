"use client";

import { useState } from "react";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

type VehicleWithCustomer = {
  id: string;
  branchId: string | null;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  customer: {
    name: string;
    phone: string;
  };
};

type ServiceOption = {
  id: string;
  category: string | null;
  name: string;
  price: number;
};

type WorkOrderFormProps = {
  action: (formData: FormData) => Promise<void>;
  vehicle: VehicleWithCustomer;
  services: ServiceOption[];
  branches?: BranchOption[];
};

export function WorkOrderForm({
  action,
  vehicle,
  services,
  branches = [],
}: WorkOrderFormProps) {
  const [contactType, setContactType] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [serviceQuery, setServiceQuery] = useState("");
  const serviceGroups = groupServicesByCategory(services);
  const categories = ["All", ...serviceGroups.map((group) => group.category)];
  const normalizedQuery = serviceQuery.trim().toLowerCase();
  const selectedServices = services.filter((service) =>
    selectedServiceIds.includes(service.id),
  );
  const visibleServiceGroups = serviceGroups
    .filter((group) => activeCategory === "All" || group.category === activeCategory)
    .map((group) => ({
      ...group,
      services: group.services.filter((service) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          service.name.toLowerCase().includes(normalizedQuery) ||
          group.category.toLowerCase().includes(normalizedQuery)
        );
      }),
    }))
    .filter((group) => group.services.length > 0);
  const total = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const canCreateJob = selectedServices.length > 0 && Boolean(contactType);

  function toggleService(serviceId: string) {
    const clickedService = services.find((service) => service.id === serviceId);

    if (!clickedService) {
      return;
    }

    const clickedCategory = getServiceCategory(clickedService);

    setSelectedServiceIds((current) => {
      if (current.includes(serviceId)) {
        return current.filter((id) => id !== serviceId);
      }

      const otherCategorySelections = current.filter((id) => {
        const selectedService = services.find((service) => service.id === id);
        return selectedService
          ? getServiceCategory(selectedService) !== clickedCategory
          : false;
      });

      return [...otherCategorySelections, serviceId];
    });
  }

  return (
    <form action={action} className="job-pos-form">
      <input type="hidden" name="vehicleId" value={vehicle.id} />
      {selectedServiceIds.map((serviceId) => (
        <input key={serviceId} type="hidden" name="serviceIds" value={serviceId} />
      ))}

      <div className="job-pos-workspace">
        <aside className="panel job-cart-panel">
          <div className="section-header">
            <div>
              <h2>Create job</h2>
            </div>
            <span className="status">In Progress</span>
          </div>

          <div className="job-cart-cards">
            <div className="job-cart-info job-cart-info-primary">
              <span>Customer</span>
              <strong>{vehicle.customer.name}</strong>
              <small>{vehicle.customer.phone}</small>
            </div>
            <div className="job-cart-info">
              <span>Vehicle</span>
              <strong>{vehicle.plateNumber}</strong>
              <small>
                {[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") ||
                  "No vehicle details"}
              </small>
            </div>
          </div>

          <div className="job-cart-section">
            <h3>Branch</h3>
            <BranchSelect branches={branches} selectedBranchId={vehicle.branchId} />
          </div>

          <div className="job-cart-section">
            <h3>Pick up contact</h3>
            <div className="job-contact-options">
              <label
                className={`option-card ${contactType === "REGISTERED_OWNER" ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="contactType"
                  value="REGISTERED_OWNER"
                  checked={contactType === "REGISTERED_OWNER"}
                  onChange={() => setContactType("REGISTERED_OWNER")}
                  required
                />
                <span>
                  <strong>Registered</strong>
                  <small>{vehicle.customer.name}</small>
                </span>
              </label>
              <label
                className={`option-card ${contactType === "OTHER_PERSON" ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="contactType"
                  value="OTHER_PERSON"
                  checked={contactType === "OTHER_PERSON"}
                  onChange={() => setContactType("OTHER_PERSON")}
                  required
                />
                <span>
                  <strong>Other</strong>
                  <small>Pickup contact</small>
                </span>
              </label>
              <label
                className={`option-card ${contactType === "NEW_OWNER" ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="contactType"
                  value="NEW_OWNER"
                  checked={contactType === "NEW_OWNER"}
                  onChange={() => setContactType("NEW_OWNER")}
                  required
                />
                <span>
                  <strong>Transfer</strong>
                  <small>New owner</small>
                </span>
              </label>
            </div>
            {!contactType ? (
              <p className="form-hint warning-hint">Choose a pick up contact before creating the job.</p>
            ) : null}

            {contactType === "OTHER_PERSON" ? (
              <div className="field-grid job-contact-fields">
                <label>
                  <span>Other person name</span>
                  <input name="contactName" required />
                </label>
                <label>
                  <span>Other person phone</span>
                  <input
                    name="contactPhone"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]{7,20}"
                    title="Phone number can only contain numbers."
                    required
                  />
                </label>
              </div>
            ) : null}

            {contactType === "NEW_OWNER" ? (
              <div className="job-new-owner-fields">
                <div className="field-grid job-contact-fields">
                  <label>
                    <span>New owner name</span>
                    <input name="newOwnerName" required />
                  </label>
                  <label>
                    <span>New owner phone</span>
                    <input
                      name="newOwnerPhone"
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]{7,20}"
                      title="Phone number can only contain numbers."
                      required
                    />
                  </label>
                </div>

                <label>
                  <span>Ownership transfer notes optional</span>
                  <textarea name="ownershipNotes" rows={2} />
                </label>
              </div>
            ) : null}
          </div>

          <div className="job-cart-section">
            <div className="section-header">
              <h3>Selected services</h3>
              <span className="muted">{selectedServices.length} item(s)</span>
            </div>
            {selectedServices.length ? (
              <div className="job-cart-items">
                {selectedServices.map((service) => (
                  <button
                    className="job-cart-item"
                    key={service.id}
                    onClick={() => toggleService(service.id)}
                    type="button"
                  >
                    <span>{service.name}</span>
                    <strong>{formatMoney(service.price)}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">Tap service cards to add items.</p>
            )}
          </div>

          <label className="job-notes-field">
            <span>Notes optional</span>
            <textarea name="notes" rows={2} />
          </label>

          <div className="job-cart-total">
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>

          <button disabled={!canCreateJob} type="submit">
            Create job
          </button>
        </aside>

        <section className="panel job-service-panel">
          <div className="section-header">
            <div>
              <h2>Services</h2>
            </div>
          </div>

          <div className="job-category-tabs" aria-label="Service categories">
            {categories.map((category) => (
              <button
                className={activeCategory === category ? "active" : ""}
                key={category}
                onClick={() => setActiveCategory(category)}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>

          <input
            className="job-service-search"
            onChange={(event) => setServiceQuery(event.target.value)}
            placeholder="Search service"
            type="search"
            value={serviceQuery}
          />

          <div className="job-service-groups">
            {visibleServiceGroups.length ? (
              visibleServiceGroups.map((group) => (
                <div className="service-category-group" key={group.category}>
                  <div className="service-category-title">{group.category}</div>
                  <div className="job-service-card-grid">
                    {group.services.map((service) => {
                      const selected = selectedServiceIds.includes(service.id);

                      return (
                        <button
                          className={`job-service-card${selected ? " selected" : ""}`}
                          key={service.id}
                          onClick={() => toggleService(service.id)}
                          type="button"
                        >
                          <span>{service.name}</span>
                          <strong>{formatMoney(service.price)}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-state">No services match this search.</p>
            )}
          </div>
        </section>
      </div>
    </form>
  );
}

function groupServicesByCategory(services: ServiceOption[]) {
  const groups = new Map<string, ServiceOption[]>();

  services.forEach((service) => {
    const category = getServiceCategory(service);
    groups.set(category, [...(groups.get(category) ?? []), service]);
  });

  return Array.from(groups.entries()).map(([category, groupedServices]) => ({
    category,
    services: groupedServices,
  }));
}

function getServiceCategory(service: ServiceOption) {
  return service.category?.trim() || "Services";
}

function formatMoney(value: number) {
  return `RM${value.toFixed(2)}`;
}

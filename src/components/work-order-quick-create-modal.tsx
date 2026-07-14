"use client";

import { useState } from "react";
import { AppointmentVehiclePicker } from "@/components/appointment-vehicle-picker";
import { BranchSelect } from "@/components/branch-select";
import {
  WorkOrderPackagePurchase,
  type WorkOrderPackageOption,
} from "@/components/work-order-package-purchase";
import type { BranchOption } from "@/lib/branches";

type ServiceOption = {
  id: string;
  category: string | null;
  name: string;
  price: number;
};

type WorkOrderQuickCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  packageAction: (formData: FormData) => Promise<void>;
  packages: WorkOrderPackageOption[];
  services: ServiceOption[];
};

export function WorkOrderQuickCreateModal({
  action,
  branches,
  packageAction,
  packages,
  services,
}: WorkOrderQuickCreateModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"job" | "package">("job");
  const [contactType, setContactType] = useState("REGISTERED_OWNER");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [isServicePickerOpen, setIsServicePickerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(
    groupServicesByCategory(services)[0]?.category ?? "",
  );
  const serviceGroups = groupServicesByCategory(services);
  const visibleServices =
    serviceGroups.find((group) => group.category === activeCategory)?.services ??
    serviceGroups[0]?.services ??
    [];
  const selectedServices = services.filter((service) =>
    selectedServiceIds.includes(service.id),
  );

  function closeModal() {
    setIsOpen(false);
    setContactType("REGISTERED_OWNER");
    setSelectedServiceIds([]);
    setIsServicePickerOpen(false);
    setMode("job");
  }

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
    <>
      <button
        aria-label="Create job"
        className="button-link work-order-quick-create-button"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        +
      </button>

      {isOpen ? (
        <div className="appointment-create-modal-backdrop" role="presentation">
          <section
            aria-labelledby="new-job-title"
            className="appointment-create-modal work-order-quick-modal"
            role="dialog"
          >
            <div className="appointment-create-modal-header">
              <button
                aria-label="Close new job"
                className="appointment-time-close"
                onClick={closeModal}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="new-job-title">{mode === "job" ? "New Job" : "Buy Package"}</h2>
              <span />
            </div>

            <div aria-label="Transaction type" className="work-order-mode-switch">
              <button
                className={mode === "job" ? "is-active" : ""}
                onClick={() => setMode("job")}
                type="button"
              >
                Create Job
              </button>
              <button
                className={mode === "package" ? "is-active" : ""}
                onClick={() => {
                  setIsServicePickerOpen(false);
                  setMode("package");
                }}
                type="button"
              >
                Buy Package
              </button>
            </div>

            {mode === "job" ? (
              <form action={action} className="appointment-create-form">
                <div className="appointment-create-card">
                  <div className="appointment-create-primary">
                    <AppointmentVehiclePicker />
                  </div>

                  <div className="appointment-create-secondary">
                    <section className="appointment-contact-card">
                      <h3>Pick up contact</h3>
                      <div className="job-contact-options appointment-contact-options">
                        <label
                          className={`option-card ${
                            contactType === "REGISTERED_OWNER" ? "is-selected" : ""
                          }`}
                        >
                          <input
                            checked={contactType === "REGISTERED_OWNER"}
                            name="contactType"
                            onChange={() => setContactType("REGISTERED_OWNER")}
                            type="radio"
                            value="REGISTERED_OWNER"
                          />
                          <strong>Registered owner</strong>
                          <small>Use customer phone</small>
                        </label>
                        <label
                          className={`option-card ${
                            contactType === "OTHER_PERSON" ? "is-selected" : ""
                          }`}
                        >
                          <input
                            checked={contactType === "OTHER_PERSON"}
                            name="contactType"
                            onChange={() => setContactType("OTHER_PERSON")}
                            type="radio"
                            value="OTHER_PERSON"
                          />
                          <strong>Other person</strong>
                          <small>Pickup contact</small>
                        </label>
                      </div>
                      {contactType === "OTHER_PERSON" ? (
                        <div className="appointment-contact-fields">
                          <label>
                            <span>Name</span>
                            <input name="contactName" placeholder="Pickup contact name" />
                          </label>
                          <label>
                            <span>Phone</span>
                            <input
                              inputMode="numeric"
                              name="contactPhone"
                              pattern="[0-9]{7,20}"
                              placeholder="Pickup phone"
                              type="tel"
                            />
                          </label>
                        </div>
                      ) : (
                        <p>Ready reminders will use the registered owner.</p>
                      )}
                    </section>

                    <div className="appointment-service-summary">
                      {selectedServices.map((service) => (
                        <div className="appointment-service-summary-item" key={service.id}>
                          <span aria-hidden="true">{"\u25a7"}</span>
                          <div>
                            <strong>{service.name}</strong>
                            <small>{formatMoney(service.price)}</small>
                          </div>
                        </div>
                      ))}
                      <button
                        className="appointment-service-trigger"
                        onClick={() => setIsServicePickerOpen(true)}
                        type="button"
                      >
                        <span>{"\u2295"}</span>
                        <strong>Select Service</strong>
                      </button>
                    </div>

                    <BranchSelect branches={branches} />

                    <label>
                      <span>Notes optional</span>
                      <textarea name="notes" rows={2} />
                    </label>

                    {selectedServiceIds.map((serviceId) => (
                      <input key={serviceId} name="serviceIds" type="hidden" value={serviceId} />
                    ))}
                  </div>

                  <div className="appointment-create-actions">
                    <button disabled={!selectedServiceIds.length} type="submit">
                      Confirm
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <WorkOrderPackagePurchase
                action={packageAction}
                branches={branches}
                packages={packages}
              />
            )}
          </section>

          {mode === "job" && isServicePickerOpen ? (
            <section
              aria-labelledby="job-service-picker-title"
              className="appointment-edit-modal work-order-service-picker"
              role="dialog"
            >
              <div className="appointment-edit-header">
                <button
                  aria-label="Close service picker"
                  className="appointment-detail-close"
                  onClick={() => setIsServicePickerOpen(false)}
                  type="button"
                >
                  {"\u00d7"}
                </button>
                <h2 id="job-service-picker-title">Select Service</h2>
                <span />
              </div>

              <div className="appointment-service-category-tabs">
                {serviceGroups.map((group) => (
                  <button
                    className={group.category === activeCategory ? "is-active" : ""}
                    key={group.category}
                    onClick={() => setActiveCategory(group.category)}
                    type="button"
                  >
                    <span>{group.category.slice(0, 1).toUpperCase()}</span>
                    <strong>{group.category}</strong>
                  </button>
                ))}
              </div>

              <div className="appointment-service-picker-list">
                {visibleServices.map((service) => {
                  const selected = selectedServiceIds.includes(service.id);

                  return (
                    <button
                      className={selected ? "is-selected" : ""}
                      key={service.id}
                      onClick={() => toggleService(service.id)}
                      type="button"
                    >
                      <span aria-hidden="true">{"\u25a7"}</span>
                      <div>
                        <strong>{service.name}</strong>
                        <small>{formatMoney(service.price)}</small>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                className="appointment-service-save"
                onClick={() => setIsServicePickerOpen(false)}
                type="button"
              >
                Save
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
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

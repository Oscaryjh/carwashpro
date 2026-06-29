"use client";

import { useState } from "react";

type WorkOrderContactFormProps = {
  action: (formData: FormData) => Promise<void>;
  workOrder: {
    id: string;
    contactType: string;
    contactName: string | null;
    contactPhone: string | null;
    customer: {
      name: string;
      phone: string;
    };
  };
};

export function WorkOrderContactForm({
  action,
  workOrder,
}: WorkOrderContactFormProps) {
  const initialContactType =
    workOrder.contactType === "OTHER_PERSON" ? "OTHER_PERSON" : "REGISTERED_OWNER";
  const [contactType, setContactType] = useState(initialContactType);

  if (workOrder.contactType === "NEW_OWNER") {
    return (
      <div className="panel work-order-compact-panel">
        <div className="section-header">
          <h2>Edit pick up contact</h2>
        </div>
        <p className="muted">
          This work order was created with a vehicle ownership transfer. Edit the
          vehicle owner from the vehicle/customer flow to keep ownership history accurate.
        </p>
      </div>
    );
  }

  return (
    <div className="panel work-order-compact-panel work-order-contact-panel">
      <div className="section-header">
        <h2>Edit pick up contact</h2>
      </div>
      <form action={action} className="form compact-contact-form">
        <input type="hidden" name="workOrderId" value={workOrder.id} />

        <div className="option-card-list">
          <label className="option-card">
            <input
              type="radio"
              name="contactType"
              value="REGISTERED_OWNER"
              checked={contactType === "REGISTERED_OWNER"}
              onChange={() => setContactType("REGISTERED_OWNER")}
            />
            <span>
              <strong>Registered owner</strong>
              <small>
                {workOrder.customer.name} - {workOrder.customer.phone}
              </small>
            </span>
          </label>
          <label className="option-card">
            <input
              type="radio"
              name="contactType"
              value="OTHER_PERSON"
              checked={contactType === "OTHER_PERSON"}
              onChange={() => setContactType("OTHER_PERSON")}
            />
            <span>
              <strong>Other person</strong>
              <small>Use a different pickup/contact person for this work order.</small>
            </span>
          </label>
        </div>

        {contactType === "OTHER_PERSON" ? (
          <div className="field-grid">
            <label>
              <span>Other person name</span>
              <input
                name="contactName"
                defaultValue={workOrder.contactName ?? ""}
                required
              />
            </label>
            <label>
              <span>Other person phone</span>
              <input
                name="contactPhone"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{7,20}"
                title="Phone number can only contain numbers."
                defaultValue={workOrder.contactPhone ?? ""}
                required
              />
            </label>
          </div>
        ) : null}

        <div className="form-actions">
          <button type="submit">Save contact</button>
        </div>
      </form>
    </div>
  );
}

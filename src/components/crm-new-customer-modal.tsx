"use client";

import { useEffect, useState } from "react";
import { CustomerForm } from "@/components/customer-form";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { BranchOption } from "@/lib/branches";

type CrmNewCustomerModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  initialVehiclePlate?: string;
  isSalonBusiness: boolean;
  label?: string;
};

export function CrmNewCustomerModal({
  action,
  branches,
  initialVehiclePlate = "",
  isSalonBusiness,
  label = "New customer",
}: CrmNewCustomerModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button className="button-link" onClick={() => setIsOpen(true)} type="button">
        {label}
      </button>

      {isOpen ? (
        <div
          className="crm-customer-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="crm-new-customer-title"
            aria-modal="true"
            className={`crm-customer-modal${
              isSalonBusiness ? " crm-customer-modal--salon" : ""
            }`}
            role="dialog"
          >
            <header className="crm-customer-modal-header">
              <div>
                <p>CRM</p>
                <h2 id="crm-new-customer-title">New customer</h2>
                <span>
                  {isSalonBusiness
                    ? "Create a customer profile."
                    : "Create a customer and add vehicle details if needed."}
                </span>
              </div>
              <ModalCloseButton
                ariaLabel="Close new customer"
                className="crm-customer-modal-close"
                onClick={() => setIsOpen(false)}
              />
            </header>

            <div className="crm-customer-modal-body">
              <CustomerForm
                action={action}
                branches={branches}
                initialVehiclePlate={initialVehiclePlate}
                isSalonBusiness={isSalonBusiness}
                returnPath="/crm"
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

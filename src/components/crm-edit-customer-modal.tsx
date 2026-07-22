"use client";

import type { Customer } from "@prisma/client";
import { useEffect, useState } from "react";
import { CustomerForm } from "@/components/customer-form";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { BranchOption } from "@/lib/branches";

type EditableCustomer = Pick<
  Customer,
  | "id"
  | "branchId"
  | "name"
  | "phone"
  | "email"
  | "dateOfBirth"
  | "notes"
  | "preferences"
  | "treatmentNotes"
>;

type CrmEditCustomerModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  customer: EditableCustomer;
  isSalonBusiness: boolean;
  returnPath: string;
};

export function CrmEditCustomerModal({
  action,
  branches,
  customer,
  isSalonBusiness,
  returnPath,
}: CrmEditCustomerModalProps) {
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
      <button className="crm-edit-link" onClick={() => setIsOpen(true)} type="button">
        Edit
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
            aria-labelledby="crm-edit-customer-title"
            aria-modal="true"
            className={`crm-customer-modal${
              isSalonBusiness ? " crm-customer-modal--salon" : ""
            }`}
            role="dialog"
          >
            <header className="crm-customer-modal-header">
              <div>
                <p>Customer profile</p>
                <h2 id="crm-edit-customer-title">Edit customer</h2>
                <span>Update contact details and customer preferences.</span>
              </div>
              <ModalCloseButton
                ariaLabel="Close customer editor"
                className="crm-customer-modal-close"
                onClick={() => setIsOpen(false)}
              />
            </header>

            <div className="crm-customer-modal-body">
              <CustomerForm
                action={action}
                branches={branches}
                compactCreate
                customer={customer}
                isSalonBusiness={isSalonBusiness}
                mode="edit"
                returnPath={returnPath}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

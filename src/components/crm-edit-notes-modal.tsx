"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UpdateCustomerNotesState } from "@/app/(business)/crm/actions";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

type CrmEditNotesModalProps = {
  action: (
    state: UpdateCustomerNotesState,
    formData: FormData,
  ) => Promise<UpdateCustomerNotesState>;
  customerId: string;
  customerName: string;
  notes: string | null;
  preferences: string | null;
  treatmentNotes: string | null;
};

const initialState: UpdateCustomerNotesState = {
  status: "idle",
  message: "",
};

export function CrmEditNotesModal(props: CrmEditNotesModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeModal = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeModal, isOpen]);

  return (
    <>
      <button
        className="crm-edit-notes-trigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        Edit notes
      </button>

      {isOpen ? (
        <div
          className="crm-customer-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
          role="presentation"
        >
          <section
            aria-labelledby="crm-edit-notes-title"
            aria-modal="true"
            className="crm-customer-modal crm-edit-notes-modal"
            role="dialog"
          >
            <header className="crm-customer-modal-header">
              <div>
                <p>CRM NOTES</p>
                <h2 id="crm-edit-notes-title">Edit notes</h2>
                <span>{props.customerName}</span>
              </div>
              <ModalCloseButton
                ariaLabel="Close edit notes"
                className="crm-customer-modal-close"
                onClick={closeModal}
              />
            </header>

            <div className="crm-customer-modal-body">
              <CrmEditNotesForm {...props} onSaved={closeModal} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CrmEditNotesForm({
  action,
  customerId,
  notes,
  onSaved,
  preferences,
  treatmentNotes,
}: CrmEditNotesModalProps & { onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    onSaved();
    router.refresh();
  }, [onSaved, router, state.status]);

  return (
    <form action={formAction} className="crm-edit-notes-form">
      <input name="customerId" type="hidden" value={customerId} />

      <label>
        <span>General notes</span>
        <textarea
          defaultValue={notes ?? ""}
          maxLength={5000}
          name="notes"
          placeholder="General customer notes"
          rows={4}
        />
      </label>

      <div className="crm-edit-notes-fields">
        <label>
          <span>Preferences</span>
          <textarea
            defaultValue={preferences ?? ""}
            maxLength={5000}
            name="preferences"
            placeholder="Preferred stylist, products, or services"
            rows={4}
          />
        </label>
        <label>
          <span>Treatment notes</span>
          <textarea
            defaultValue={treatmentNotes ?? ""}
            maxLength={5000}
            name="treatmentNotes"
            placeholder="Colour formula, treatment history, or sensitivities"
            rows={4}
          />
        </label>
      </div>

      {state.status === "error" ? (
        <p className="form-message error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="crm-edit-notes-actions">
        <button className="secondary-button" onClick={onSaved} type="button">
          Cancel
        </button>
        <button disabled={pending} type="submit">
          {pending ? "Saving..." : "Save notes"}
        </button>
      </div>
    </form>
  );
}

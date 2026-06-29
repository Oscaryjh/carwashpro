"use client";

import { useActionState } from "react";
import {
  deleteCustomerAction,
  type DeleteCustomerState,
} from "@/app/crm/actions";

type DeleteCustomerFormProps = {
  customerId: string;
  customerName: string;
  label?: string;
};

const initialState: DeleteCustomerState = {
  status: "idle",
  message: "",
};

export function DeleteCustomerForm({
  customerId,
  customerName,
  label = "Delete customer",
}: DeleteCustomerFormProps) {
  const [state, formAction, pending] = useActionState(
    deleteCustomerAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="danger-zone-form"
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Delete ${customerName}? This cannot be undone.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="customerId" value={customerId} />
      <button className="danger-button" type="submit" disabled={pending}>
        {pending ? "Deleting..." : label}
      </button>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

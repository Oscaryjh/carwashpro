"use client";

import { useActionState } from "react";
import {
  deleteServiceAction,
  type DeleteServiceState,
} from "@/app/(business)/services/actions";

type DeleteServiceFormProps = {
  serviceId: string;
  serviceName: string;
  label?: string;
  compact?: boolean;
};

const initialState: DeleteServiceState = {
  status: "idle",
  message: "",
};

export function DeleteServiceForm({
  serviceId,
  serviceName,
  label = "Delete",
  compact = false,
}: DeleteServiceFormProps) {
  const [state, formAction, pending] = useActionState(
    deleteServiceAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className={`danger-zone-form${compact ? " catalog-delete-form" : ""}`}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Are you sure you want to delete "${serviceName}"? This cannot be undone.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="serviceId" value={serviceId} />
      <button className="danger-button" type="submit" disabled={pending}>
        {pending ? "Deleting..." : label}
      </button>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

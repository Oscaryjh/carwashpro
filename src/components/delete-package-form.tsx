"use client";

import { useActionState } from "react";
import {
  deletePackageAction,
  type DeletePackageState,
} from "@/app/packages/actions";

type DeletePackageFormProps = {
  packageId: string;
  packageName: string;
  label?: string;
};

const initialState: DeletePackageState = {
  status: "idle",
  message: "",
};

export function DeletePackageForm({
  packageId,
  packageName,
  label = "Delete",
}: DeletePackageFormProps) {
  const [state, formAction, pending] = useActionState(
    deletePackageAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="danger-zone-form"
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Are you sure you want to delete "${packageName}"? This cannot be undone.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="packageId" value={packageId} />
      <button className="danger-button" type="submit" disabled={pending}>
        {pending ? "Deleting..." : label}
      </button>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

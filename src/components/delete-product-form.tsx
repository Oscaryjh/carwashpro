"use client";

import { useActionState } from "react";
import {
  deleteProductAction,
  type DeleteProductState,
} from "@/app/(business)/products/actions";

type DeleteProductFormProps = {
  productId: string;
  productName: string;
  label?: string;
  compact?: boolean;
};

const initialState: DeleteProductState = {
  status: "idle",
  message: "",
};

export function DeleteProductForm({
  productId,
  productName,
  label = "Delete",
  compact = false,
}: DeleteProductFormProps) {
  const [state, formAction, pending] = useActionState(
    deleteProductAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className={`danger-zone-form${compact ? " catalog-delete-form" : ""}`}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Are you sure you want to delete "${productName}"? This cannot be undone.`,
        );

        if (!confirmed) event.preventDefault();
      }}
    >
      <input name="productId" type="hidden" value={productId} />
      <button className="danger-button" disabled={pending} type="submit">
        {pending ? "Deleting..." : label}
      </button>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

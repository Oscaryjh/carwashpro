"use client";

import { useActionState } from "react";
import type {
  CreateBusinessState,
  createBusinessAction,
} from "@/app/admin/businesses/actions";
import { BusinessForm } from "@/components/business-form";

type BusinessCreateFormProps = {
  action: typeof createBusinessAction;
};

const initialState: CreateBusinessState = {
  status: "idle",
  message: "",
};

export function BusinessCreateForm({ action }: BusinessCreateFormProps) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <BusinessForm
      action={formAction}
      mode="create"
      showOwnerFields
      formError={state.status === "error" ? state.message : undefined}
      fieldErrors={state.fieldErrors}
    />
  );
}

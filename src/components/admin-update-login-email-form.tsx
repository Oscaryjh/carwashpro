"use client";

import { useActionState } from "react";
import {
  adminUpdateUserEmailAction,
  type AdminUpdateUserEmailState,
} from "@/app/admin/businesses/actions";

type AdminUpdateLoginEmailFormProps = {
  businessId: string;
  userId: string;
  email: string | null;
};

const initialState: AdminUpdateUserEmailState = {
  status: "idle",
  message: "",
};

export function AdminUpdateLoginEmailForm({
  businessId,
  userId,
  email,
}: AdminUpdateLoginEmailFormProps) {
  const [state, formAction, pending] = useActionState(
    adminUpdateUserEmailAction,
    initialState,
  );

  return (
    <form action={formAction} className="inline-account-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="userId" value={userId} />
      <input
        aria-label={`Login email for ${email ?? "staff member"}`}
        name="email"
        type="email"
        defaultValue={email ?? ""}
        autoComplete="off"
        required
      />
      <button type="submit" disabled={pending}>
        {pending ? "Updating..." : "Update"}
      </button>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

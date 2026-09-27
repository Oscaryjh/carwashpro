"use client";

import { useActionState, useEffect } from "react";
import {
  adminUpdateUserEmailAction,
  type AdminUpdateUserEmailState,
} from "@/app/admin/businesses/actions";

type AdminUpdateLoginEmailFormProps = {
  businessId: string;
  userId: string;
  email: string | null;
  onCancel?: () => void;
  onSuccess?: (message: string) => void;
};

const initialState: AdminUpdateUserEmailState = {
  status: "idle",
  message: "",
};

export function AdminUpdateLoginEmailForm({
  businessId,
  userId,
  email,
  onCancel,
  onSuccess,
}: AdminUpdateLoginEmailFormProps) {
  const [state, formAction, pending] = useActionState(
    adminUpdateUserEmailAction,
    initialState,
  );

  useEffect(() => { if (state.status === "success") onSuccess?.(state.message); }, [state, onSuccess]);

  return (
    <form action={formAction} className="inline-account-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="userId" value={userId} />
      <label>Login email<input
        aria-label={`Login email for ${email ?? "staff member"}`}
        name="email"
        type="email"
        defaultValue={email ?? ""}
        autoComplete="off"
        required
      /></label>
      <div className="form-actions">
        {onCancel && <button className="secondary-light-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button>}
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
      </div>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>
      ) : null}
    </form>
  );
}

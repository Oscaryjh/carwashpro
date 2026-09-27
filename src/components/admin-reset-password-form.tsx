"use client";

import { useActionState, useEffect, useRef } from "react";
import { passwordConfirmationError } from "./admin-workspace-state";
import {
  adminResetUserPasswordAction,
  type AdminResetUserPasswordState,
} from "@/app/admin/businesses/actions";

type AdminResetPasswordFormProps = {
  businessId: string;
  userId: string;
  userEmail: string | null;
  onCancel?: () => void;
  onSuccess?: (message: string) => void;
};

const initialState: AdminResetUserPasswordState = {
  status: "idle",
  message: "",
};

export function AdminResetPasswordForm({
  businessId,
  userId,
  userEmail,
  onCancel,
  onSuccess,
}: AdminResetPasswordFormProps) {
  const [state, formAction, pending] = useActionState(
    adminResetUserPasswordAction,
    initialState,
  );
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      passwordRef.current?.form?.reset();
      onSuccess?.(state.message);
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="inline-password-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="userId" value={userId} />
      <label>New password<input
        ref={passwordRef}
        aria-label={`New password for ${userEmail ?? "staff member"}`}
        name="newPassword"
        type="password"
        minLength={6}
        autoComplete="new-password"
        onInput={() => confirmationRef.current?.setCustomValidity(passwordConfirmationError(passwordRef.current?.value ?? "", confirmationRef.current.value))}
        placeholder="New password"
        required
      /></label>
      <label>Confirm password<input ref={confirmationRef} type="password" autoComplete="new-password" required onInput={(event) => event.currentTarget.setCustomValidity(passwordConfirmationError(passwordRef.current?.value ?? "", event.currentTarget.value))} /></label>
      <div className="form-actions">
        {onCancel && <button className="secondary-light-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button>}
        <button type="submit" disabled={pending}>{pending ? "Resetting…" : "Reset password"}</button>
      </div>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>
      ) : null}
    </form>
  );
}

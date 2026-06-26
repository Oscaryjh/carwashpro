"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  adminResetUserPasswordAction,
  type AdminResetUserPasswordState,
} from "@/app/admin/businesses/actions";

type AdminResetPasswordFormProps = {
  businessId: string;
  userId: string;
  userEmail: string;
};

const initialState: AdminResetUserPasswordState = {
  status: "idle",
  message: "",
};

export function AdminResetPasswordForm({
  businessId,
  userId,
  userEmail,
}: AdminResetPasswordFormProps) {
  const [state, formAction, pending] = useActionState(
    adminResetUserPasswordAction,
    initialState,
  );
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      passwordRef.current?.form?.reset();
    }
  }, [state.status]);

  return (
    <form action={formAction} className="inline-password-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="userId" value={userId} />
      <input
        ref={passwordRef}
        aria-label={`New password for ${userEmail}`}
        name="newPassword"
        type="password"
        minLength={8}
        placeholder="New password"
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

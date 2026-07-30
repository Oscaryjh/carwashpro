"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type {
  BusinessGroupActionState,
  addBusinessToGroupAction,
} from "@/app/admin/business-groups/actions";

type BusinessGroupFormAction = typeof addBusinessToGroupAction;

type BusinessGroupActionFormProps = {
  action: BusinessGroupFormAction;
  children: ReactNode;
  className?: string;
  confirmMessage?: string;
};

const initialState: BusinessGroupActionState = {
  status: "idle",
  message: "",
};

export function BusinessGroupActionForm({
  action,
  children,
  className,
  confirmMessage,
}: BusinessGroupActionFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      aria-busy={pending}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children}
      {state.status === "error" ? (
        <p className="form-message error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="form-message success" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

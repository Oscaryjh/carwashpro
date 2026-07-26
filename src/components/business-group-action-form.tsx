"use client";

import { useActionState, type ReactNode } from "react";
import type {
  BusinessGroupActionState,
  addBusinessToGroupAction,
} from "@/app/admin/business-groups/actions";

type BusinessGroupFormAction = typeof addBusinessToGroupAction;

type BusinessGroupActionFormProps = {
  action: BusinessGroupFormAction;
  children: ReactNode;
  className?: string;
};

const initialState: BusinessGroupActionState = {
  status: "idle",
  message: "",
};

export function BusinessGroupActionForm({
  action,
  children,
  className,
}: BusinessGroupActionFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.status === "error" ? (
        <p className="form-message error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

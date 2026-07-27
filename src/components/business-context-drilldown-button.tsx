"use client";

import { useActionState } from "react";
import { switchBusinessContextAction } from "@/app/(business)/business-context/actions";
import type { BusinessContextActionState } from "@/lib/business-groups/business-context";

const initialState: BusinessContextActionState = { status: "idle" };

export function BusinessContextDrilldownButton({
  businessId,
  contextToken,
  label = "Open store",
  returnTo,
}: {
  businessId: string;
  contextToken: string;
  label?: string;
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState(
    switchBusinessContextAction,
    initialState,
  );

  return (
    <form action={formAction} className="group-store-action">
      <input name="targetBusinessId" type="hidden" value={businessId} />
      <input name="contextToken" type="hidden" value={contextToken} />
      {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
      <button disabled={pending} type="submit">
        {pending ? "Opening..." : label}
      </button>
      {state.status === "error" ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}

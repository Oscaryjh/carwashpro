"use client";

import { useActionState } from "react";
import { switchBusinessContextAction } from "@/app/(business)/business-context/actions";
import type { BusinessContextActionState } from "@/lib/business-groups/business-context";

const initialState: BusinessContextActionState = { status: "idle" };

export function BusinessContextDrilldownButton({
  businessId,
  contextToken,
}: {
  businessId: string;
  contextToken: string;
}) {
  const [state, formAction, pending] = useActionState(
    switchBusinessContextAction,
    initialState,
  );

  return (
    <form action={formAction} className="group-store-action">
      <input name="targetBusinessId" type="hidden" value={businessId} />
      <input name="contextToken" type="hidden" value={contextToken} />
      <button disabled={pending} type="submit">
        {pending ? "Opening..." : "Open store"}
      </button>
      {state.status === "error" ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}

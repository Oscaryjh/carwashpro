"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { switchBusinessContextAction } from "@/app/(business)/business-context/actions";
import type {
  AvailableBusinessContext,
  BusinessContextActionState,
} from "@/lib/business-groups/business-context";

type BusinessContextSwitcherProps = {
  businesses: AvailableBusinessContext[];
  contextToken: string;
  groupName: string;
};

const initialBusinessContextActionState: BusinessContextActionState = {
  status: "idle",
};

export function BusinessContextSwitcher({
  businesses,
  contextToken,
  groupName,
}: BusinessContextSwitcherProps) {
  const pathname = usePathname();
  const current = businesses.find((business) => business.isCurrent);
  const [state, formAction, pending] = useActionState(
    switchBusinessContextAction,
    initialBusinessContextActionState,
  );

  return (
    <form action={formAction} className="business-context-switcher">
      <label htmlFor="business-context-target">{groupName}</label>
      <div>
        <select
          defaultValue={current?.id}
          disabled={pending}
          id="business-context-target"
          name="targetBusinessId"
        >
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
        <button disabled={pending} type="submit">
          {pending ? "Switching..." : "Switch"}
        </button>
      </div>
      <input name="contextToken" type="hidden" value={contextToken} />
      <input name="returnTo" type="hidden" value={pathname ?? "/reports"} />
      {state.status === "error" ? (
        <p role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

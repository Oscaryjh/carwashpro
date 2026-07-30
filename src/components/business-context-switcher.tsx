"use client";

import Link from "next/link";
import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { switchBusinessContextAction } from "@/app/(business)/business-context/actions";
import type {
  AvailableBusinessContext,
  BusinessContextActionState,
} from "@/lib/business-groups/business-context";
import type { AuthorizedGroupReportingContext } from "@/lib/business-groups/all-stores-access";

type BusinessContextSwitcherProps = {
  groups: AuthorizedGroupReportingContext[];
  homeBusiness: AvailableBusinessContext | null;
  contextToken: string;
  selectedGroupId?: string;
};

const initialBusinessContextActionState: BusinessContextActionState = {
  status: "idle",
};

export function BusinessContextSwitcher({
  groups,
  homeBusiness,
  contextToken,
  selectedGroupId,
}: BusinessContextSwitcherProps) {
  const pathname = usePathname();
  const initialGroupId =
    selectedGroupId ??
    groups.find((group) =>
      group.businesses.some((business) => business.isCurrent),
    )?.groupId ??
    groups[0]?.groupId ??
    (homeBusiness ? "home" : "");
  const [activeGroupId, setActiveGroupId] = useState(initialGroupId);
  const activeGroup = groups.find((group) => group.groupId === activeGroupId);
  const businesses = useMemo(
    () =>
      activeGroup
        ? activeGroup.businesses
        : homeBusiness
          ? [homeBusiness]
          : [],
    [activeGroup, homeBusiness],
  );
  const current = businesses.find((business) => business.isCurrent);
  const [state, formAction, pending] = useActionState(
    switchBusinessContextAction,
    initialBusinessContextActionState,
  );
  const actionState = state ?? initialBusinessContextActionState;
  const showHomeContext =
    Boolean(homeBusiness) &&
    !groups.some((group) =>
      group.businesses.some((business) => business.id === homeBusiness?.id),
    );
  const contextOptions = groups.length + (showHomeContext ? 1 : 0);

  return (
    <div className="business-context-switcher">
      <div className="business-context-scope">
        <label htmlFor="business-context-group">Business group</label>
        {contextOptions > 1 ? (
          <select
            id="business-context-group"
            onChange={(event) => setActiveGroupId(event.target.value)}
            value={activeGroupId}
          >
            {groups.map((group) => (
              <option key={group.groupId} value={group.groupId}>
                {group.groupName}
              </option>
            ))}
            {showHomeContext ? <option value="home">Direct business</option> : null}
          </select>
        ) : (
          <strong>{activeGroup?.groupName ?? "Direct business"}</strong>
        )}
      </div>
      <form action={formAction}>
        <label htmlFor="business-context-target">Business</label>
        <div>
          <select
            defaultValue={current?.id ?? businesses[0]?.id}
            disabled={pending}
            id="business-context-target"
            key={activeGroupId}
            name="targetBusinessId"
          >
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
          <button disabled={pending || !businesses.length} type="submit">
            {pending ? "Switching..." : "Switch"}
          </button>
        </div>
        <input name="contextToken" type="hidden" value={contextToken} />
        <input name="returnTo" type="hidden" value={pathname ?? "/reports"} />
        {actionState.status === "error" ? (
          <p role="alert">{actionState.message}</p>
        ) : null}
      </form>
      {activeGroup?.canViewAllStores ? (
        <Link
          className="business-context-all-stores"
          href={`/groups/${activeGroup.groupId}/overview`}
        >
          All Stores
        </Link>
      ) : null}
    </div>
  );
}

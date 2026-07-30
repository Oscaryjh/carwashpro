"use client";

import { useMemo, useState } from "react";

type EligibleUser = {
  id: string;
  name: string;
  email: string | null;
  businessName: string | null;
};

type GroupBusiness = {
  id: string;
  name: string;
};

type BusinessGroupExistingUserAccessFieldsProps = {
  businesses: GroupBusiness[];
  groupId: string;
  users: EligibleUser[];
};

export function BusinessGroupExistingUserAccessFields({
  businesses,
  groupId,
  users,
}: BusinessGroupExistingUserAccessFieldsProps) {
  const [role, setRole] = useState<"GROUP_OWNER" | "GROUP_MANAGER">("GROUP_OWNER");
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return users;

    return users.filter((user) =>
      [user.name, user.email ?? "", user.businessName ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      ),
    );
  }, [normalizedQuery, users]);

  return (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="userId" value={selectedUserId} />

      <div className="business-group-existing-user-picker">
        <div className="business-group-picker-toolbar">
          <label>
            Find an existing user
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or business"
              autoComplete="off"
            />
          </label>
          <div className="business-group-picker-count" aria-live="polite">
            {filteredUsers.length} of {users.length}
          </div>
        </div>
        <div
          className="business-group-existing-user-results"
          role="radiogroup"
          aria-label="Eligible existing users"
        >
          {filteredUsers.length ? (
            filteredUsers.map((user) => {
              const selected = selectedUserId === user.id;
              return (
                <label
                  className={selected ? "is-selected" : ""}
                  key={user.id}
                >
                  <input
                    type="radio"
                    name="existingUserPicker"
                    value={user.id}
                    checked={selected}
                    onChange={() => setSelectedUserId(user.id)}
                  />
                  <span>
                    <strong>{user.name}</strong>
                    <small>
                      {user.email ?? "No login email"} - {user.businessName ?? "No business"}
                    </small>
                  </span>
                </label>
              );
            })
          ) : (
            <p className="business-group-picker-empty">No eligible users match this search.</p>
          )}
        </div>
        <span className="muted">
          Their existing login remains unchanged. This adds group access only.
        </span>
      </div>

      <fieldset className="business-group-account-section business-group-account-access">
        <legend>Access level</legend>
        <p className="muted">Choose how much of this group the existing user can access.</p>

        <div className="business-group-role-selector">
          <label className={role === "GROUP_OWNER" ? "is-selected" : ""}>
            <input
              type="radio"
              name="role"
              value="GROUP_OWNER"
              checked={role === "GROUP_OWNER"}
              onChange={() => setRole("GROUP_OWNER")}
            />
            <span>
              <strong>Group owner</strong>
              <small>Full access to every active business in this group.</small>
            </span>
          </label>
          <label className={role === "GROUP_MANAGER" ? "is-selected" : ""}>
            <input
              type="radio"
              name="role"
              value="GROUP_MANAGER"
              checked={role === "GROUP_MANAGER"}
              onChange={() => setRole("GROUP_MANAGER")}
            />
            <span>
              <strong>Group manager</strong>
              <small>Access only to the businesses selected below.</small>
            </span>
          </label>
        </div>

        {role === "GROUP_OWNER" ? (
          <div className="business-group-owner-summary">
            <div>
              <strong>All group businesses</strong>
              <span>
                Includes all {businesses.length} active {businesses.length === 1 ? "business" : "businesses"}
                {" "}and any business added later.
              </span>
            </div>
            <span className="status active">Automatic</span>
          </div>
        ) : (
          <div className="business-group-manager-scope">
            <div className="business-group-manager-scope-heading">
              <div>
                <strong>Manager business scope</strong>
                <span>Select at least one business.</span>
              </div>
              <span>{businesses.length} available</span>
            </div>
            {businesses.length ? (
              <div className="business-group-manager-scope-list">
                {businesses.map((business) => (
                  <label key={business.id}>
                    <input type="checkbox" name="businessIds" value={business.id} />
                    <span>{business.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="empty-state">Add an active business before granting manager access.</p>
            )}
          </div>
        )}
      </fieldset>

      <div className="business-group-account-actions">
        <span className="muted">This does not change the user&apos;s existing business role.</span>
        <button
          type="submit"
          disabled={
            !selectedUserId || (role === "GROUP_MANAGER" && businesses.length === 0)
          }
        >
          Grant group access
        </button>
      </div>
    </>
  );
}

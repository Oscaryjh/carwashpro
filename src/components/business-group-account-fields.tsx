"use client";

import { useState } from "react";

type GroupBusiness = {
  id: string;
  name: string;
};

type BusinessGroupAccountFieldsProps = {
  businesses: GroupBusiness[];
  groupId: string;
};

export function BusinessGroupAccountFields({
  businesses,
  groupId,
}: BusinessGroupAccountFieldsProps) {
  const [role, setRole] = useState<"GROUP_OWNER" | "GROUP_MANAGER">("GROUP_OWNER");

  return (
    <>
      <input type="hidden" name="groupId" value={groupId} />

      <fieldset className="business-group-account-section">
        <legend>Login details</legend>
        <p className="muted">
          This account signs in independently and is not attached to one business.
        </p>
        <div className="business-group-account-credentials">
          <label>
            Name
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              placeholder="e.g. Oscar"
            />
          </label>
          <label>
            Login email
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="name@example.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
            />
          </label>
          <label>
            Confirm password
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="Enter the password again"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="business-group-account-section business-group-account-access">
        <legend>Access level</legend>
        <p className="muted">Choose what this person can access across the group.</p>

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
              <p className="empty-state">Add an active business before creating a manager.</p>
            )}
          </div>
        )}
      </fieldset>

      <div className="business-group-account-actions">
        <span className="muted">The new user can sign in immediately after creation.</span>
        <button type="submit" disabled={role === "GROUP_MANAGER" && businesses.length === 0}>
          Create group login
        </button>
      </div>
    </>
  );
}

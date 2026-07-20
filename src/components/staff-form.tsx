"use client";

import { useState } from "react";
import type { User } from "@prisma/client";
import {
  getDefaultStaffPermissionsForIndustry,
  getStaffPermissionsForIndustry,
} from "@/lib/auth/staff-permissions";

type StaffBranch = {
  id: string;
  name: string;
};

type StaffFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: StaffBranch[];
  staff?: User;
  assignedBranchIds?: string[];
  industryType?: string;
  submitLabel: string;
};

type AccessType = "LOGIN" | "NO_LOGIN";

export function StaffForm({
  action,
  branches,
  staff,
  assignedBranchIds = [],
  industryType,
  submitLabel,
}: StaffFormProps) {
  const isEdit = Boolean(staff);
  const [accessType, setAccessType] = useState<AccessType>(
    staff?.loginEnabled === false ? "NO_LOGIN" : "LOGIN",
  );
  const selectedPermissions =
    staff?.permissions ??
    (accessType === "LOGIN" ? getDefaultStaffPermissionsForIndustry(industryType) : []);
  const selectedBranchIds = new Set(
    assignedBranchIds.length ? assignedBranchIds : staff?.branchId ? [staff.branchId] : [],
  );

  return (
    <form className="form" action={action}>
      {staff ? <input type="hidden" name="userId" value={staff.id} /> : null}
      <input name="accessType" type="hidden" value={accessType} />
      <fieldset className="team-fieldset" disabled={!branches.length}>
        <div className="field-grid">
          <label>
            <span>Name</span>
            <input name="name" defaultValue={staff?.name ?? ""} required />
          </label>
          <label>
            <span>Employee phone / WhatsApp optional</span>
            <input
              inputMode="numeric"
              name="whatsappPhone"
              placeholder="60123456789"
              defaultValue={staff?.whatsappPhone ?? ""}
            />
            <small className="form-hint">Used to match this employee in the future staff app.</small>
          </label>
          <div className={`staff-branch-picker${branches.length === 1 ? " staff-branch-picker-single" : ""}`}>
            <div className="staff-branch-heading">
              <span>Work branches</span>
            </div>
            <div className="staff-branch-options">
              {branches.length === 1 ? (
                <>
                  <input type="hidden" name="branchIds" value={branches[0].id} />
                  <div className="staff-branch-fixed-card">
                    <input
                      aria-label={`${branches[0].name} assigned`}
                      checked
                      className="staff-branch-fixed-check"
                      disabled
                      readOnly
                      type="checkbox"
                    />
                    <span className="staff-branch-fixed-copy">
                      <strong>{branches[0].name}</strong>
                      <small>Only active branch</small>
                    </span>
                    <span className="staff-branch-fixed-state">Auto-assigned</span>
                  </div>
                </>
              ) : (
                branches.map((branch) => (
                  <label key={branch.id}>
                    <input
                      defaultChecked={selectedBranchIds.has(branch.id)}
                      name="branchIds"
                      type="checkbox"
                      value={branch.id}
                    />
                    <span>{branch.name}</span>
                  </label>
                ))
              )}
            </div>
            {branches.length > 1 ? (
              <small className="form-hint">
                Select every branch where this employee may work.
              </small>
            ) : null}
          </div>
          {isEdit ? (
            <label>
              <span>Status</span>
              <select name="status" defaultValue={staff?.status ?? "active"}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="staff-access-mode">
          <h3>System access</h3>
          <div className="staff-access-options">
            <label className={accessType === "LOGIN" ? "selected" : ""}>
              <input
                checked={accessType === "LOGIN"}
                onChange={() => setAccessType("LOGIN")}
                type="radio"
              />
              <span>
                <strong>Login account</strong>
                <small>Give this staff access to selected system features.</small>
              </span>
            </label>
            <label className={accessType === "NO_LOGIN" ? "selected" : ""}>
              <input
                checked={accessType === "NO_LOGIN"}
                onChange={() => setAccessType("NO_LOGIN")}
                type="radio"
              />
              <span>
                <strong>Staff record only</strong>
                <small>For service or cleaning staff who do not need to log in.</small>
              </span>
            </label>
          </div>
          <p className="form-hint">
            Staff record only employees can still be assigned to appointments and kept in
            branch records.
          </p>
        </div>

        {accessType === "LOGIN" ? (
          <div className="field-grid staff-login-fields">
            <label>
              <span>Email / Login ID</span>
              <input
                name="email"
                type="email"
                defaultValue={staff?.email ?? ""}
                required
              />
            </label>
            <label>
              <span>{isEdit ? "Reset password optional" : "Temporary password"}</span>
              <input
                name="password"
                type="password"
                minLength={8}
                placeholder={isEdit ? "Leave blank to keep current" : "At least 8 characters"}
                required={!isEdit || staff?.loginEnabled === false}
              />
            </label>
          </div>
        ) : null}

        {isEdit ? (
          <p className="form-hint">
            Set status to inactive to disable the staff record while keeping shift, payment,
            and activity history.
          </p>
        ) : null}
        <PermissionChecklist
          defaultPermissions={accessType === "LOGIN" ? selectedPermissions : []}
          disabled={accessType === "NO_LOGIN"}
          industryType={industryType}
          title="Access permissions"
        />
      </fieldset>
      <div className="form-actions">
        <button type="submit" disabled={!branches.length}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function PermissionChecklist({
  defaultPermissions,
  disabled = false,
  industryType,
  title,
}: {
  defaultPermissions: string[];
  disabled?: boolean;
  industryType?: string;
  title?: string;
}) {
  const selected = new Set(defaultPermissions);

  return (
    <div className={`permission-section${disabled ? " disabled" : ""}`}>
      {title ? <h3>{title}</h3> : null}
      {disabled ? (
        <p className="form-hint">No permissions are needed for a staff record without login.</p>
      ) : null}
      <div className="permission-grid">
        {getStaffPermissionsForIndustry(industryType)
          .filter((permission) => permission.key !== "DASHBOARD")
          .map((permission) => (
          <label className="permission-card" key={permission.key}>
            <input
              defaultChecked={selected.has(permission.key)}
              disabled={disabled}
              name="permissions"
              type="checkbox"
              value={permission.key}
            />
            <span>
              <strong>{permission.label}</strong>
              <small>{permission.description}</small>
            </span>
          </label>
          ))}
      </div>
    </div>
  );
}

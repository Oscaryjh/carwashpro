"use client";

import { useState } from "react";
import {
  getDefaultStaffPermissionsForIndustry,
  getStaffPermissionsForIndustry,
} from "@/lib/auth/staff-permissions";

export type StaffFormStaff = {
  appointmentBookable: boolean;
  branchId: string | null;
  email: string | null;
  id: string;
  loginEnabled: boolean;
  name: string;
  permissions: string[];
  staffLevelId: string | null;
  staffRoleProfileId: string | null;
  status: string;
  whatsappPhone: string | null;
};
type StaffBranch = {
  id: string;
  name: string;
};

type StaffFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: StaffBranch[];
  staff?: StaffFormStaff;
  employeeProfile?: {
    attendanceEnabled: boolean;
    canClockInBranchIds: string[];
    employeeCode: string;
    employmentType: string;
    payBasis: "MONTHLY" | "DAILY" | "HOURLY";
    baseSalary: string | null;
    normalWorkMinutesPerDay: number | null;
    targetBreakMinutes: number | null;
    joinedAt: string;
    primaryBranchId: string;
    status: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  } | null;
  assignedBranchIds?: string[];
  industryType?: string;
  roleProfiles?: Array<{ id: string; name: string }>;
  selectedServiceIds?: string[];
  services?: Array<{ id: string; name: string }>;
  staffLevels?: Array<{ id: string; name: string }>;
  submitLabel: string;
};

type AccessType = "LOGIN" | "NO_LOGIN";

export function StaffForm({
  action,
  branches,
  staff,
  employeeProfile,
  assignedBranchIds = [],
  industryType,
  roleProfiles = [],
  selectedServiceIds = [],
  services = [],
  staffLevels = [],
  submitLabel,
}: StaffFormProps) {
  const isEdit = Boolean(staff);
  const isLegacyEdit = Boolean(staff && !employeeProfile);
  const [createEmploymentProfile, setCreateEmploymentProfile] = useState(false);
  const hasEmploymentForm =
    !isEdit || Boolean(employeeProfile) || createEmploymentProfile;
  const isLegacyOnlyEdit = isLegacyEdit && !createEmploymentProfile;

  const [accessType, setAccessType] = useState<AccessType>(
    staff
      ? staff.loginEnabled ? "LOGIN" : "NO_LOGIN"
      : "NO_LOGIN",
  );
  const selectedPermissions =
    staff?.permissions ??
    (accessType === "LOGIN" ? getDefaultStaffPermissionsForIndustry(industryType) : []);
  const [attendanceEnabled, setAttendanceEnabled] = useState(
    employeeProfile?.attendanceEnabled ?? false,
  );
  const [providesServices, setProvidesServices] = useState(
    staff?.appointmentBookable ?? false,
  );
  const [selectedRoleProfileId, setSelectedRoleProfileId] = useState(
    staff?.staffRoleProfileId ?? "",
  );
  const fallbackSingleBranchId = branches.length === 1 ? branches[0]?.id : undefined;
  const initialSelectedBranchIds = assignedBranchIds.length
    ? assignedBranchIds
    : staff?.branchId
      ? [staff.branchId]
      : fallbackSingleBranchId
        ? [fallbackSingleBranchId]
        : [];
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(
    initialSelectedBranchIds,
  );
  const [primaryBranchId, setPrimaryBranchId] = useState(
    employeeProfile?.primaryBranchId ?? initialSelectedBranchIds[0] ?? "",
  );
  const [canClockInBranchIds, setCanClockInBranchIds] = useState<string[]>(
    employeeProfile?.canClockInBranchIds ?? initialSelectedBranchIds,
  );
  const [employmentStatus, setEmploymentStatus] = useState<
    "ACTIVE" | "SUSPENDED" | "TERMINATED"
  >(employeeProfile?.status ?? "ACTIVE");

  function updateBranchSelection(branchId: string, checked: boolean) {
    const nextBranchIds = checked
      ? Array.from(new Set([...selectedBranchIds, branchId]))
      : selectedBranchIds.filter((id) => id !== branchId);

    setSelectedBranchIds(nextBranchIds);
    if (!nextBranchIds.includes(primaryBranchId)) {
      setPrimaryBranchId(nextBranchIds[0] ?? "");
    }
    setCanClockInBranchIds((current) =>
      checked
        ? Array.from(new Set([...current, branchId]))
        : current.filter((id) => id !== branchId),
    );
  }

  function updateEmploymentStatus(status: "ACTIVE" | "SUSPENDED" | "TERMINATED") {
    setEmploymentStatus(status);
    if (status === "TERMINATED") {
      setAttendanceEnabled(false);
      setProvidesServices(false);
      setAccessType("NO_LOGIN");
    }
  }

  return (
    <form className="form" action={action}>
      {staff ? <input type="hidden" name="userId" value={staff.id} /> : null}
      <input name="accessType" type="hidden" value={accessType} />
      <input
        name="appointmentBookable"
        type="hidden"
        value={providesServices ? "on" : ""}
      />
      <input
        name="staffRoleProfileId"
        type="hidden"
        value={selectedRoleProfileId}
      />
      {isLegacyEdit ? (
        <label className="staff-appointment-setting">
          <input
            checked={createEmploymentProfile}
            name="createEmploymentProfile"
            onChange={(event) =>
              setCreateEmploymentProfile(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>Create employment profile</strong>
            <small>
              Add employee code, pay, work hours, breaks and Attendance access
              to this existing Staff profile.
            </small>
          </span>
        </label>
      ) : null}
      <fieldset className="team-fieldset" disabled={!branches.length}>
        <div className="field-grid">
          <label>
            <span>Full name</span>
            <input name="name" defaultValue={staff?.name ?? ""} required />
          </label>
          <label>
            <span>Phone number</span>
            <input
              autoComplete="tel"
              inputMode="tel"
              name="whatsappPhone"
              placeholder="+60 12-345 6789"
              defaultValue={staff?.whatsappPhone ?? ""}
              required={hasEmploymentForm}
              type="tel"
            />
            <small className="form-hint">
              Used for this person&apos;s employee identity and future attendance access.
            </small>
          </label>
          {hasEmploymentForm ? (
            <>
              <label>
                <span>Employee code</span>
                <input
                  autoComplete="off"
                  defaultValue={employeeProfile?.employeeCode ?? ""}
                  maxLength={50}
                  name="employeeCode"
                  placeholder="EMP-001"
                  required
                />
              </label>
              <label>
                <span>Employment type</span>
                <select
                  defaultValue={employeeProfile?.employmentType ?? "FULL_TIME"}
                  name="employmentType"
                >
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="DAILY">Daily</option>
                  <option value="HOURLY">Hourly</option>
                </select>
              </label>
              <label>
                <span>Pay basis</span>
                <select
                  defaultValue={employeeProfile?.payBasis ?? "MONTHLY"}
                  name="payBasis"
                >
                  <option value="MONTHLY">Monthly salary</option>
                  <option value="DAILY">Daily rate</option>
                  <option value="HOURLY">Hourly rate</option>
                </select>
              </label>
              <label>
                <span>Base pay (RM)</span>
                <input
                  defaultValue={employeeProfile?.baseSalary ?? ""}
                  inputMode="decimal"
                  min="0"
                  name="baseSalary"
                  placeholder="2000.00"
                  step="0.01"
                  type="number"
                />
                <small className="form-hint">
                  Payroll foundation only; statutory deductions are not calculated yet.
                </small>
              </label>
              <label>
                <span>Paid work minutes / day (optional)</span>
                <input
                  defaultValue={employeeProfile?.normalWorkMinutesPerDay ?? ""}
                  max="1440"
                  min="60"
                  name="normalWorkMinutesPerDay"
                  placeholder="Use branch policy"
                  step="1"
                  type="number"
                />
              </label>
              <label>
                <span>Expected break minutes (optional)</span>
                <input
                  defaultValue={employeeProfile?.targetBreakMinutes ?? ""}
                  max="480"
                  min="0"
                  name="targetBreakMinutes"
                  placeholder="Use branch policy"
                  step="1"
                  type="number"
                />
              </label>
              <label>
                <span>Joined date</span>
                <input
                  defaultValue={employeeProfile?.joinedAt ?? ""}
                  name="joinedAt"
                  required
                  type="date"
                />
              </label>
              <label>
                <span>Employment status</span>
                <select
                  name="status"
                  onChange={(event) =>
                    updateEmploymentStatus(
                      event.target.value as "ACTIVE" | "SUSPENDED" | "TERMINATED",
                    )
                  }
                  value={employmentStatus}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="TERMINATED">Terminated</option>
                </select>
              </label>
            </>
          ) : null}
          <div className={`staff-branch-picker${branches.length === 1 ? " staff-branch-picker-single" : ""}`}>
            <div className="staff-branch-heading">
              <span>{isLegacyOnlyEdit ? "Branch" : "Work branches"}</span>
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
                      checked={selectedBranchIds.includes(branch.id)}
                      name="branchIds"
                      onChange={(event) => {
                        if (isLegacyOnlyEdit) {
                          setSelectedBranchIds([branch.id]);
                          setPrimaryBranchId(branch.id);
                          return;
                        }
                        updateBranchSelection(branch.id, event.target.checked);
                      }}
                      type={isLegacyOnlyEdit ? "radio" : "checkbox"}
                      value={branch.id}
                    />
                    <span>{branch.name}</span>
                  </label>
                ))
              )}
            </div>
            {isLegacyOnlyEdit ? (
              <>
                <input
                  name="primaryBranchId"
                  type="hidden"
                  value={selectedBranchIds[0] ?? ""}
                />
                <small className="form-hint">
                  Additional work branches become available after an employment
                  profile is linked.
                </small>
              </>
            ) : (
              <label>
                <span>
                  {accessType === "LOGIN"
                    ? "Primary branch / POS home branch"
                    : "Primary branch"}
                </span>
                <select
                  name="primaryBranchId"
                  onChange={(event) => setPrimaryBranchId(event.target.value)}
                  required
                  value={primaryBranchId}
                >
                  <option value="">Select a primary branch</option>
                  {branches
                    .filter((branch) => selectedBranchIds.includes(branch.id))
                    .map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {branches.length > 1 ? (
              <small className="form-hint">
                {isLegacyOnlyEdit
                  ? "Choose the current branch for this Staff profile."
                  : "Select every branch where this employee may work."}
              </small>
            ) : null}
          </div>
        </div>

        {employmentStatus === "TERMINATED" && (!isEdit || employeeProfile) ? (
          <div className="warning">
            Termination disables attendance, services, and POS access while preserving
            historical records.
          </div>
        ) : null}

        {attendanceEnabled && selectedBranchIds.length ? (
          <fieldset className="service-staff-fieldset">
            <legend>Branches allowed for clock in</legend>
            <div className="service-staff-grid">
              {branches
                .filter((branch) => selectedBranchIds.includes(branch.id))
                .map((branch) => (
                  <label className="service-staff-option" key={branch.id}>
                    <input
                      checked={canClockInBranchIds.includes(branch.id)}
                      name="canClockInBranchIds"
                      onChange={(event) =>
                        setCanClockInBranchIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, branch.id]))
                            : current.filter((id) => id !== branch.id),
                        )
                      }
                      type="checkbox"
                      value={branch.id}
                    />
                    <span>
                      <strong>{branch.name}</strong>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        ) : null}

        <div className="team-member-feature-options">
          {isLegacyOnlyEdit ? (
            <div className="staff-legacy-attendance-note">
              <span aria-hidden="true">i</span>
              <span>
                <strong>Attendance needs an employment profile</strong>
                <small>
                  Create or link an employment profile before enabling attendance.
                </small>
              </span>
            </div>
          ) : (
            <label className="staff-appointment-setting">
              <input
                checked={attendanceEnabled}
                name="attendanceEnabled"
                onChange={(event) => setAttendanceEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Enable attendance</strong>
                <small>Allow attendance access at the assigned branches.</small>
              </span>
            </label>
          )}
          <label className="staff-appointment-setting">
            <input
              checked={providesServices}
              name="providesServices"
              onChange={(event) => setProvidesServices(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Provides services / accepts appointments</strong>
              <small>Show this person in service and appointment staff selectors.</small>
            </span>
          </label>
          <label className="staff-appointment-setting">
            <input
              checked={accessType === "LOGIN"}
              name="posAccess"
              onChange={(event) =>
                setAccessType(event.target.checked ? "LOGIN" : "NO_LOGIN")
              }
              type="checkbox"
            />
            <span>
              <strong>Can access POS back office</strong>
              <small>Enable email login and selected system permissions.</small>
            </span>
          </label>
        </div>

        {providesServices ? (
          <section className="staff-access-mode" aria-labelledby="service-profile-heading">
            <h3 id="service-profile-heading">Service & appointment profile</h3>
            <div className="field-grid">
              <label>
                <span>Role</span>
                <select
                  onChange={(event) => setSelectedRoleProfileId(event.target.value)}
                  value={selectedRoleProfileId}
                >
                  <option value="">No service role</option>
                  {roleProfiles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Level</span>
                <select
                  defaultValue={staff?.staffLevelId ?? ""}
                  name="staffLevelId"
                >
                  <option value="">No level</option>
                  {staffLevels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="service-staff-fieldset">
              <legend>Assigned services</legend>
              {services.length ? (
                <div className="service-staff-grid">
                  {services.map((service) => (
                    <label className="service-staff-option" key={service.id}>
                      <input
                        defaultChecked={selectedServiceIds.includes(service.id)}
                        name="serviceIds"
                        type="checkbox"
                        value={service.id}
                      />
                      <span>
                        <strong>{service.name}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="form-hint">No active services are available.</p>
              )}
            </fieldset>
            <p className="form-hint">
              Weekly availability and time off can be managed from Team &gt; Schedule
              after saving.
            </p>
          </section>
        ) : null}

        {accessType === "LOGIN" ? (
          <section
            className="staff-access-mode"
            aria-labelledby="pos-access-heading"
          >
            <h3 id="pos-access-heading">POS access</h3>
            <p className="form-hint">
              POS access is optional and remains separate from attendance and service
              availability.
            </p>
            <div className="field-grid">
              <label>
                <span>Login Role</span>
                <select
                  onChange={(event) => setSelectedRoleProfileId(event.target.value)}
                  value={selectedRoleProfileId}
                >
                  <option value="">No login role</option>
                  {roleProfiles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="service-staff-fieldset">
              <legend>Authorized Branches</legend>
              <div className="service-staff-grid">
                {branches.map((branch) => (
                  <label className="service-staff-option" key={branch.id}>
                    <input
                      aria-label={`${branch.name} authorized for POS`}
                      checked={selectedBranchIds.includes(branch.id)}
                      disabled={branches.length === 1}
                      onChange={(event) =>
                        updateBranchSelection(branch.id, event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{branch.name}</strong>
                      {branch.id === primaryBranchId ? (
                        <small>POS home branch</small>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <small className="form-hint">
                These are the same work-branch assignments shown above. The primary
                branch is this person&apos;s POS home branch.
              </small>
            </fieldset>
          </section>
        ) : null}

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

        {accessType === "LOGIN" ? (
          <details className="staff-permission-override">
            <summary>
              <span>
                <strong>Permission Level</strong>
                <small>
                  Advanced permission override for access that differs from the selected
                  login role.
                </small>
              </span>
              <span className="staff-permission-override-action">Configure</span>
            </summary>
            <PermissionChecklist
              defaultPermissions={selectedPermissions}
              industryType={industryType}
            />
          </details>
        ) : (
          <div className="staff-record-access-note">
            <strong>No system permissions</strong>
            <span>
              This team member can still use attendance or provide services when those
              options are enabled.
            </span>
          </div>
        )}
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
  description,
  disabled = false,
  industryType,
  title,
}: {
  defaultPermissions: string[];
  description?: string;
  disabled?: boolean;
  industryType?: string;
  title?: string;
}) {
  const selected = new Set(defaultPermissions);

  return (
    <div className={`permission-section${disabled ? " disabled" : ""}`}>
      {title ? <h3>{title}</h3> : null}
      {description ? <p className="permission-section-description">{description}</p> : null}
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

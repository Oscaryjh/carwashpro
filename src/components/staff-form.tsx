import type { User } from "@prisma/client";
import {
  defaultStaffPermissions,
  staffPermissions,
} from "@/lib/auth/staff-permissions";

type StaffBranch = {
  id: string;
  name: string;
};

type StaffFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: StaffBranch[];
  staff?: User;
  submitLabel: string;
};

export function StaffForm({ action, branches, staff, submitLabel }: StaffFormProps) {
  const selectedPermissions = staff?.permissions ?? defaultStaffPermissions;
  const isEdit = Boolean(staff);

  return (
    <form className="form" action={action}>
      {staff ? <input type="hidden" name="userId" value={staff.id} /> : null}
      <fieldset className="team-fieldset" disabled={!branches.length}>
        <div className="field-grid">
          <label>
            <span>Name</span>
            <input name="name" defaultValue={staff?.name ?? ""} required />
          </label>
          <label>
            <span>Email / Login ID</span>
            <input name="email" type="email" defaultValue={staff?.email ?? ""} required />
          </label>
          <label>
            <span>WhatsApp Number optional</span>
            <input
              inputMode="numeric"
              name="whatsappPhone"
              placeholder="60123456789"
              defaultValue={staff?.whatsappPhone ?? ""}
            />
          </label>
          <label>
            <span>Branch</span>
            <select name="branchId" required defaultValue={staff?.branchId ?? ""}>
              <option value="" disabled>
                Select branch
              </option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          {isEdit ? (
            <label>
              <span>Status</span>
              <select name="status" defaultValue={staff?.status ?? "active"}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>{isEdit ? "Reset password optional" : "Temporary password"}</span>
            <input
              name="password"
              type="password"
              minLength={8}
              placeholder={isEdit ? "Leave blank to keep current" : ""}
              required={!isEdit}
            />
          </label>
        </div>
        {isEdit ? (
          <p className="form-hint">
            Set status to inactive to disable login while keeping shift, payment, and job
            history.
          </p>
        ) : null}
        <PermissionChecklist
          defaultPermissions={selectedPermissions}
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
  title,
}: {
  defaultPermissions: string[];
  title?: string;
}) {
  const selected = new Set(defaultPermissions);

  return (
    <div className="permission-section">
      {title ? <h3>{title}</h3> : null}
      <div className="permission-grid">
        {staffPermissions.map((permission) => (
          <label className="permission-card" key={permission.key}>
            <input
              defaultChecked={selected.has(permission.key)}
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

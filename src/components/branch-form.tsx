import type { Branch } from "@prisma/client";

type BranchFormProps = {
  action: (formData: FormData) => Promise<void>;
  branch?: Branch;
  submitLabel: string;
};

export function BranchForm({ action, branch, submitLabel }: BranchFormProps) {
  return (
    <form action={action} className="form">
      {branch ? <input type="hidden" name="branchId" value={branch.id} /> : null}
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={branch?.name ?? ""} required />
        </label>
        <label>
          <span>Phone optional</span>
          <input name="phone" defaultValue={branch?.phone ?? ""} />
        </label>
        {branch ? (
          <label>
            <span>Status</span>
            <select name="status" defaultValue={branch.status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      <label>
        <span>Address optional</span>
        <textarea name="address" rows={3} defaultValue={branch?.address ?? ""} />
      </label>
      <div className="form-actions">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

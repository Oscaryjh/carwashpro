import type { Branch } from "@prisma/client";

type BranchFormProps = {
  action: (formData: FormData) => Promise<void>;
  branch?: Branch;
  businessId?: string;
  submitLabel: string;
};

export function BranchForm({
  action,
  branch,
  businessId,
  submitLabel,
}: BranchFormProps) {
  return (
    <form action={action} className="form branch-form">
      {branch ? <input type="hidden" name="branchId" value={branch.id} /> : null}
      {businessId ? <input type="hidden" name="businessId" value={businessId} /> : null}
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={branch?.name ?? ""} required />
        </label>
        <label>
          <span>Phone optional</span>
          <input name="phone" defaultValue={branch?.phone ?? ""} />
        </label>
      </div>
      <label>
        <span>Address optional</span>
        <textarea name="address" rows={3} defaultValue={branch?.address ?? ""} />
      </label>
      <div className="form-actions branch-form-actions">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

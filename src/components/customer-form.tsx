import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

type CustomerFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches?: BranchOption[];
};

export function CustomerForm({ action, branches = [] }: CustomerFormProps) {
  return (
    <form action={action} className="form">
      <div className="field-grid">
        <BranchSelect branches={branches} />
        <label>
          <span>Name</span>
          <input name="name" required />
        </label>
        <label>
          <span>Phone</span>
          <input name="phone" required />
        </label>
        <label>
          <span>Email optional</span>
          <input name="email" type="email" />
        </label>
      </div>
      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} />
      </label>
      <div className="form-actions">
        <button type="submit">Create customer</button>
      </div>
    </form>
  );
}

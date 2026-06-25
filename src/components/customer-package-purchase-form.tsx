import type { Package } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

type CustomerPackagePurchaseFormProps = {
  action: (formData: FormData) => Promise<void>;
  customerId: string;
  packages: Package[];
  branches?: BranchOption[];
  selectedBranchId?: string | null;
};

export function CustomerPackagePurchaseForm({
  action,
  customerId,
  packages,
  branches = [],
  selectedBranchId,
}: CustomerPackagePurchaseFormProps) {
  if (!packages.length) {
    return (
      <p className="empty-state">
        No active packages yet. Create a package before selling prepaid washes.
      </p>
    );
  }

  return (
    <form action={action} className="form">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="field-grid">
        <BranchSelect branches={branches} selectedBranchId={selectedBranchId} />
        <label>
          <span>Package</span>
          <select name="packageId" required>
            {packages.map((packagePlan) => (
              <option key={packagePlan.id} value={packagePlan.id}>
                {packagePlan.name} - {packagePlan.totalUses} washes - RM
                {Number(packagePlan.price).toFixed(2)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit">Sell package</button>
      </div>
    </form>
  );
}

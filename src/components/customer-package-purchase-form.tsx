import type { Package } from "@prisma/client";

type CustomerPackagePurchaseFormProps = {
  action: (formData: FormData) => Promise<void>;
  customerId: string;
  packages: Package[];
};

export function CustomerPackagePurchaseForm({
  action,
  customerId,
  packages,
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

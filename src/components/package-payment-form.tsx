import type { CustomerPackage, Package } from "@prisma/client";

type CustomerPackageWithPlan = CustomerPackage & {
  package: Package;
};

type PackagePaymentFormProps = {
  action: (formData: FormData) => Promise<void>;
  workOrderId: string;
  customerPackages: CustomerPackageWithPlan[];
};

export function PackagePaymentForm({
  action,
  workOrderId,
  customerPackages,
}: PackagePaymentFormProps) {
  if (!customerPackages.length) {
    return (
      <p className="empty-state">
        This customer has no active prepaid wash package with remaining uses.
      </p>
    );
  }

  return (
    <form action={action} className="form">
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <div className="field-grid">
        <label>
          <span>Prepaid package</span>
          <select name="customerPackageId" required>
            {customerPackages.map((customerPackage) => (
              <option key={customerPackage.id} value={customerPackage.id}>
                {customerPackage.package.name} - {customerPackage.remainingUses}/
                {customerPackage.totalUses} washes left
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit">Use 1 package wash</button>
      </div>
    </form>
  );
}

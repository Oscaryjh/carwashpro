import type { Package } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { CustomerPackageSelector } from "@/components/customer-package-selector";
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
        No active packages yet. Create a package before selling prepaid packages.
      </p>
    );
  }

  const packageOptions = packages.map((packagePlan) => ({
    id: packagePlan.id,
    name: packagePlan.name,
    price: Number(packagePlan.price),
    totalUses: packagePlan.totalUses,
  }));

  return (
    <form action={action} className="form customer-package-purchase-form">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="customer-package-purchase-top">
        <BranchSelect branches={branches} selectedBranchId={selectedBranchId} />
      </div>
      <CustomerPackageSelector packages={packageOptions} />
    </form>
  );
}

import type {
  Package,
  PackageCategory,
  Service,
  ServiceCategory,
} from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { PackageServiceBenefitsField } from "@/components/package-service-benefits-field";
import type { BranchOption } from "@/lib/branches";

type PackageFormProps = {
  action: (formData: FormData) => Promise<void>;
  packagePlan?: Package;
  categories?: Pick<PackageCategory, "id" | "name" | "status">[];
  services: Array<
    Pick<Service, "id" | "name" | "category"> & {
      serviceCategory?: Pick<ServiceCategory, "name"> | null;
    }
  >;
  branches?: BranchOption[];
  submitLabel?: string;
  formId?: string;
  isSalonBusiness?: boolean;
  serviceBenefits?: Array<{ serviceId: string; totalUses: number }>;
};

export function PackageForm({
  action,
  packagePlan,
  categories = [],
  services,
  branches = [],
  submitLabel,
  formId,
  isSalonBusiness = false,
  serviceBenefits = [],
}: PackageFormProps) {
  const serviceGroups = Array.from(
    services.reduce((groups, service) => {
      const categoryName =
        service.serviceCategory?.name ?? service.category?.trim() ?? "Other services";
      const categoryServices = groups.get(categoryName) ?? [];
      categoryServices.push(service);
      groups.set(categoryName, categoryServices);
      return groups;
    }, new Map<string, typeof services>()),
  ).sort(([left], [right]) => {
    if (left === "Other services") return 1;
    if (right === "Other services") return -1;
    return left.localeCompare(right);
  });

  return (
    <form action={action} className="form" id={formId}>
      {packagePlan ? (
        <input type="hidden" name="packageId" value={packagePlan.id} />
      ) : null}
      <div className="field-grid">
        <BranchSelect branches={branches} selectedBranchId={packagePlan?.branchId} />
        <label>
          <span>Category</span>
          <select name="categoryId" defaultValue={packagePlan?.categoryId ?? ""} required>
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.status === "INACTIVE" ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Name</span>
          <input
            name="name"
            defaultValue={
              packagePlan?.name ?? (isSalonBusiness ? "" : "10 Wash Package")
            }
            placeholder={
              isSalonBusiness ? "e.g. Hair Wash 5 Sessions" : "e.g. 10 Wash Package"
            }
            required
          />
        </label>
        <label>
          <span>Package price</span>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={
              packagePlan
                ? Number(packagePlan.price).toFixed(2)
                : isSalonBusiness
                  ? ""
                  : "180.00"
            }
            placeholder="0.00"
            required
          />
        </label>
        {!isSalonBusiness ? (
          <>
            <label>
              <span>Total washes</span>
              <input
                name="totalUses"
                type="number"
                min="1"
                step="1"
                defaultValue={packagePlan?.totalUses ?? 10}
                placeholder="10"
                required
              />
            </label>
            <label>
              <span>Linked service optional</span>
              <select name="serviceId" defaultValue={packagePlan?.serviceId ?? ""}>
                <option value="">Any wash service</option>
                {serviceGroups.map(([categoryName, categoryServices]) => (
                  <optgroup key={categoryName} label={categoryName}>
                    {categoryServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {packagePlan ? (
          <label>
            <span>Status</span>
            <select name="status" defaultValue={packagePlan.status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      {isSalonBusiness ? (
        <PackageServiceBenefitsField
          services={services.map((service) => ({
            id: service.id,
            name: service.name,
            categoryName:
              service.serviceCategory?.name ?? service.category?.trim() ?? "Other services",
          }))}
          initialBenefits={serviceBenefits}
        />
      ) : null}
      <label>
        <span>Description optional</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={
            packagePlan?.description ??
            (isSalonBusiness ? "" : "Prepaid 10-wash package.")
          }
          placeholder={
            isSalonBusiness
              ? "Describe what is included in this package."
              : "Describe what is included in this wash package."
          }
        />
      </label>
      {submitLabel ? (
        <div className="form-actions">
          <button type="submit">{submitLabel}</button>
        </div>
      ) : null}
    </form>
  );
}

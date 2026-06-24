import type { Package, Service } from "@prisma/client";

type PackageFormProps = {
  action: (formData: FormData) => Promise<void>;
  packagePlan?: Package;
  services: Pick<Service, "id" | "name">[];
  submitLabel: string;
};

export function PackageForm({
  action,
  packagePlan,
  services,
  submitLabel,
}: PackageFormProps) {
  return (
    <form action={action} className="form">
      {packagePlan ? (
        <input type="hidden" name="packageId" value={packagePlan.id} />
      ) : null}
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input
            name="name"
            defaultValue={packagePlan?.name ?? "10 Wash Package"}
            required
          />
        </label>
        <label>
          <span>Prepaid price</span>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={packagePlan ? Number(packagePlan.price).toFixed(2) : "180.00"}
            required
          />
        </label>
        <label>
          <span>Total washes</span>
          <input
            name="totalUses"
            type="number"
            min="1"
            step="1"
            defaultValue={packagePlan?.totalUses ?? 10}
            required
          />
        </label>
        <label>
          <span>Linked service optional</span>
          <select name="serviceId" defaultValue={packagePlan?.serviceId ?? ""}>
            <option value="">Any wash service</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
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
      <label>
        <span>Description optional</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={packagePlan?.description ?? "Prepaid 10-wash package."}
        />
      </label>
      <div className="form-actions">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

import type { Service, ServiceCategory } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

type ServiceFormProps = {
  action: (formData: FormData) => Promise<void>;
  service?: Service;
  categories?: Pick<ServiceCategory, "id" | "name" | "status">[];
  branches?: BranchOption[];
  submitLabel?: string;
  formId?: string;
};

export function ServiceForm({
  action,
  service,
  categories = [],
  branches = [],
  submitLabel,
  formId,
}: ServiceFormProps) {
  return (
    <form action={action} className="form" id={formId}>
      {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}
      <div className="field-grid">
        <BranchSelect branches={branches} selectedBranchId={service?.branchId} />
        <label>
          <span>Category</span>
          <select
            name="categoryId"
            defaultValue={service?.categoryId ?? ""}
            required
          >
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
            defaultValue={service?.name ?? ""}
            placeholder="Basic Wash - Small Car"
            required
          />
        </label>
        <label>
          <span>Price</span>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            placeholder="10.00"
            defaultValue={service ? Number(service.price).toFixed(2) : ""}
            required
          />
        </label>
        {service ? (
          <label>
            <span>Status</span>
            <select name="status" defaultValue={service.status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      {submitLabel ? (
        <div className="form-actions">
          <button type="submit">{submitLabel}</button>
        </div>
      ) : null}
    </form>
  );
}

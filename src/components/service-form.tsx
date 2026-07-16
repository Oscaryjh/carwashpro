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
  isSalonBusiness?: boolean;
  staffOptions?: Array<{
    id: string;
    name: string;
    role: string;
    branchName: string | null;
  }>;
  selectedStaffIds?: string[];
};

export function ServiceForm({
  action,
  service,
  categories = [],
  branches = [],
  submitLabel,
  formId,
  isSalonBusiness = false,
  staffOptions = [],
  selectedStaffIds = [],
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
            placeholder={isSalonBusiness ? "Haircut" : "Basic Wash - Small Car"}
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
        {isSalonBusiness ? (
          <label>
            <span>Duration</span>
            <div className="input-with-suffix">
              <input
                name="durationMinutes"
                type="number"
                step="5"
                min="5"
                max="720"
                placeholder="60"
                defaultValue={service?.durationMinutes ?? ""}
                required
              />
              <span>minutes</span>
            </div>
          </label>
        ) : null}
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
      {isSalonBusiness ? (
        <fieldset className="service-staff-fieldset">
          <legend>Available staff</legend>
          <p className="field-helper">
            Select the team members who can perform this service. Leave all
            unchecked to allow every active team member.
          </p>
          {staffOptions.length ? (
            <div className="service-staff-grid">
              {staffOptions.map((staff) => (
                <label className="service-staff-option" key={staff.id}>
                  <input
                    type="checkbox"
                    name="staffIds"
                    value={staff.id}
                    defaultChecked={selectedStaffIds.includes(staff.id)}
                  />
                  <span>
                    <strong>{staff.name}</strong>
                    <small>
                      {staff.role === "BUSINESS_OWNER" ? "Owner" : "Staff"}
                      {staff.branchName ? ` · ${staff.branchName}` : ""}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="empty-state compact-empty-state">
              No active staff accounts are available yet.
            </p>
          )}
        </fieldset>
      ) : null}
      {submitLabel ? (
        <div className="form-actions">
          <button type="submit">{submitLabel}</button>
        </div>
      ) : null}
    </form>
  );
}

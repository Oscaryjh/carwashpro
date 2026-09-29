import type { Service, ServiceCategory } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { ServiceTaxFields } from "@/components/service-tax-fields";
import type { BranchOption } from "@/lib/branches";

type ServiceFormProps = {
  action: (formData: FormData) => Promise<void>;
  service?: Service;
  companySstRate?: number | null;
  categories?: Pick<ServiceCategory, "id" | "name" | "status">[];
  branches?: BranchOption[];
  submitLabel?: string;
  formId?: string;
  modalLayout?: boolean;
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
  companySstRate,
  categories = [],
  branches = [],
  submitLabel,
  formId,
  modalLayout = false,
  isSalonBusiness = false,
  staffOptions = [],
  selectedStaffIds = [],
}: ServiceFormProps) {
  const durationField = isSalonBusiness ? (
    <label>
      <span>Duration</span>
      <div className="input-with-suffix">
        <input name="durationMinutes" type="number" step="5" min="5" max="720"
          placeholder="60" defaultValue={service?.durationMinutes ?? ""} required />
        <span>minutes</span>
      </div>
    </label>
  ) : null;
  return (
    <form action={action} className={modalLayout ? "form service-create-form" : "form"} id={formId}>
      {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}
      {modalLayout ? <BranchSelect branches={branches} selectedBranchId={service?.branchId} /> : null}
      <div className="field-grid">
        {!modalLayout ? <BranchSelect branches={branches} selectedBranchId={service?.branchId} /> : null}
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
        {modalLayout ? durationField : null}
        <ServiceTaxFields
          compact={modalLayout}
          defaultTaxable={service?.taxable ?? true}
          defaultTaxRate={service?.taxRate == null ? "" : Number(service.taxRate).toFixed(2)}
          companySstRate={companySstRate}
        />
        {!modalLayout ? durationField : null}
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
          {!modalLayout || staffOptions.length > 0 ? <p className="field-helper">
            Select the team members who can perform this service. Leave all
            unchecked to allow every active team member.
          </p> : null}
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
            modalLayout ? <div className="service-staff-empty">
              <strong>No active staff available</strong>
              <p className="field-helper">Add staff in People &amp; HR to assign this service.</p>
            </div> : <p className="empty-state compact-empty-state">
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

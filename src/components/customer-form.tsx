import type { Customer } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { UppercaseInput } from "@/components/uppercase-input";
import type { BranchOption } from "@/lib/branches";

type CustomerFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches?: BranchOption[];
  customer?: Customer;
  mode?: "create" | "edit";
  initialVehiclePlate?: string;
};

export function CustomerForm({
  action,
  branches = [],
  customer,
  mode = "create",
  initialVehiclePlate = "",
}: CustomerFormProps) {
  return (
    <form action={action} className="form">
      {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
      <div className="field-grid">
        <BranchSelect
          branches={branches}
          selectedBranchId={customer?.branchId}
        />
        <label>
          <span>Name</span>
          <input name="name" defaultValue={customer?.name ?? ""} required />
        </label>
        <label>
          <span>Phone</span>
          <input name="phone" defaultValue={customer?.phone ?? ""} required />
        </label>
        <label>
          <span>Email optional</span>
          <input name="email" type="email" defaultValue={customer?.email ?? ""} />
        </label>
      </div>
      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} defaultValue={customer?.notes ?? ""} />
      </label>

      {mode === "create" ? (
        <div className="subsection">
          <h3>Vehicle details</h3>
          <div className="field-grid">
            <label>
              <span>Plate number optional</span>
              <UppercaseInput
                name="plateNumber"
                defaultValue={initialVehiclePlate}
                autoCapitalize="characters"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Brand optional</span>
              <input name="brand" />
            </label>
            <label>
              <span>Model optional</span>
              <input name="model" />
            </label>
            <label>
              <span>Color optional</span>
              <input name="color" />
            </label>
          </div>
          <label>
            <span>Vehicle notes optional</span>
            <textarea name="vehicleNotes" rows={3} />
          </label>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit">
          {mode === "create" ? "Create customer" : "Save customer"}
        </button>
      </div>
    </form>
  );
}

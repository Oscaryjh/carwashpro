import type { Customer, Vehicle } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { UppercaseInput } from "@/components/uppercase-input";
import type { BranchOption } from "@/lib/branches";

type VehicleFormProps = {
  action: (formData: FormData) => Promise<void>;
  customers: Pick<Customer, "id" | "name" | "phone">[];
  branches?: BranchOption[];
  selectedCustomerId?: string;
  selectedBranchId?: string | null;
  vehicle?: Vehicle;
  mode?: "create" | "edit";
  lockCustomer?: boolean;
};

export function VehicleForm({
  action,
  customers,
  branches = [],
  selectedCustomerId,
  selectedBranchId,
  vehicle,
  mode = "create",
  lockCustomer = false,
}: VehicleFormProps) {
  const currentCustomerId = selectedCustomerId ?? vehicle?.customerId ?? "";
  const currentCustomer = customers.find(
    (customer) => customer.id === currentCustomerId,
  );

  return (
    <form action={action} className="form">
      {vehicle ? <input type="hidden" name="vehicleId" value={vehicle.id} /> : null}
      <BranchSelect
        branches={branches}
        selectedBranchId={vehicle?.branchId ?? selectedBranchId}
      />

      {lockCustomer || mode === "edit" ? (
        <>
          <input type="hidden" name="customerId" value={currentCustomerId} />
          <label>
            <span>Customer</span>
            <div className="read-only-field">
              {currentCustomer
                ? `${currentCustomer.name} - ${currentCustomer.phone}`
                : "Current customer"}
            </div>
          </label>
        </>
      ) : (
        <label>
          <span>Customer</span>
          <select name="customerId" defaultValue={currentCustomerId} required>
            <option value="" disabled>
              Select customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} - {customer.phone}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="field-grid">
        <label>
          <span>Plate number</span>
          <UppercaseInput
            name="plateNumber"
            defaultValue={vehicle?.plateNumber ?? ""}
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>Brand optional</span>
          <input name="brand" defaultValue={vehicle?.brand ?? ""} />
        </label>
        <label>
          <span>Model optional</span>
          <input name="model" defaultValue={vehicle?.model ?? ""} />
        </label>
        <label>
          <span>Color optional</span>
          <input name="color" defaultValue={vehicle?.color ?? ""} />
        </label>
      </div>

      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} defaultValue={vehicle?.notes ?? ""} />
      </label>

      <div className="form-actions">
        <button type="submit">
          {mode === "create" ? "Create vehicle" : "Save vehicle"}
        </button>
      </div>
    </form>
  );
}

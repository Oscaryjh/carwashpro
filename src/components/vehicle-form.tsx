import type { Customer } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

type VehicleFormProps = {
  action: (formData: FormData) => Promise<void>;
  customers: Pick<Customer, "id" | "name" | "phone">[];
  branches?: BranchOption[];
  selectedCustomerId?: string;
  selectedBranchId?: string | null;
};

export function VehicleForm({
  action,
  customers,
  branches = [],
  selectedCustomerId,
  selectedBranchId,
}: VehicleFormProps) {
  return (
    <form action={action} className="form">
      <BranchSelect branches={branches} selectedBranchId={selectedBranchId} />

      <label>
        <span>Customer</span>
        <select name="customerId" defaultValue={selectedCustomerId ?? ""} required>
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

      <div className="field-grid">
        <label>
          <span>Plate number</span>
          <input name="plateNumber" required />
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
        <span>Notes optional</span>
        <textarea name="notes" rows={3} />
      </label>

      <div className="form-actions">
        <button type="submit">Create vehicle</button>
      </div>
    </form>
  );
}

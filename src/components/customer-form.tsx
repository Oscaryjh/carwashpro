import type { Customer } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { UppercaseInput } from "@/components/uppercase-input";
import { VehicleSelectFields } from "@/components/vehicle-select-fields";
import type { BranchOption } from "@/lib/branches";

type CustomerFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches?: BranchOption[];
  customer?: Customer;
  mode?: "create" | "edit";
  initialName?: string;
  initialNotes?: string;
  initialPhone?: string;
  initialVehiclePlate?: string;
  whatsappConversationId?: string;
};

export function CustomerForm({
  action,
  branches = [],
  customer,
  mode = "create",
  initialName = "",
  initialNotes = "",
  initialPhone = "",
  initialVehiclePlate = "",
  whatsappConversationId,
}: CustomerFormProps) {
  return (
    <form action={action} className="form">
      {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
      {whatsappConversationId ? (
        <input
          type="hidden"
          name="whatsappConversationId"
          value={whatsappConversationId}
        />
      ) : null}
      <div className="field-grid">
        <BranchSelect
          branches={branches}
          selectedBranchId={customer?.branchId}
        />
        <label>
          <span>Name</span>
          <input name="name" defaultValue={customer?.name ?? initialName} required />
        </label>
        <label>
          <span>Phone</span>
          <input name="phone" defaultValue={customer?.phone ?? initialPhone} required />
        </label>
        <label>
          <span>Email optional</span>
          <input name="email" type="email" defaultValue={customer?.email ?? ""} />
        </label>
      </div>
      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} defaultValue={customer?.notes ?? initialNotes} />
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
            <VehicleSelectFields />
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

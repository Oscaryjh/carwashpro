import type { Customer } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { UppercaseInput } from "@/components/uppercase-input";
import { VehicleSelectFields } from "@/components/vehicle-select-fields";
import type { BranchOption } from "@/lib/branches";

type CustomerFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches?: BranchOption[];
  compactCreate?: boolean;
  customer?: Pick<
    Customer,
    | "id"
    | "branchId"
    | "name"
    | "phone"
    | "email"
    | "dateOfBirth"
    | "notes"
    | "preferences"
    | "treatmentNotes"
  >;
  mode?: "create" | "edit";
  initialName?: string;
  initialNotes?: string;
  initialPhone?: string;
  initialVehiclePlate?: string;
  isSalonBusiness?: boolean;
  returnPath?: string;
  whatsappConversationId?: string;
};

export function CustomerForm({
  action,
  branches = [],
  compactCreate = false,
  customer,
  mode = "create",
  initialName = "",
  initialNotes = "",
  initialPhone = "",
  initialVehiclePlate = "",
  isSalonBusiness = false,
  returnPath,
  whatsappConversationId,
}: CustomerFormProps) {
  return (
    <form action={action} className="form">
      {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
      {returnPath ? <input type="hidden" name="returnPath" value={returnPath} /> : null}
      {whatsappConversationId ? (
        <input
          type="hidden"
          name="whatsappConversationId"
          value={whatsappConversationId}
        />
      ) : null}
      <div className={`field-grid${compactCreate ? " crm-primary-customer-fields" : ""}`}>
        {compactCreate ? null : (
        <BranchSelect
          branches={branches}
          selectedBranchId={customer?.branchId}
        />
        )}
        <label>
          <span>Name</span>
          <input name="name" defaultValue={customer?.name ?? initialName} required />
        </label>
        <label>
          <span>Phone</span>
          <input name="phone" defaultValue={customer?.phone ?? initialPhone} required />
        </label>
        {compactCreate ? null : <label>
          <span>Email optional</span>
          <input name="email" type="email" defaultValue={customer?.email ?? ""} />
        </label>}
        <label>
          <span>Date of birth optional</span>
          <input
            name="dateOfBirth"
            type="date"
            defaultValue={customer?.dateOfBirth?.toISOString().slice(0, 10) ?? ""}
            max={new Date().toISOString().slice(0, 10)}
          />
        </label>
      </div>

      {compactCreate ? (
        <details className="crm-additional-details">
          <summary>
            <span>Additional details</span>
            <small>Email, branch, notes and preferences</small>
          </summary>
          <div className="crm-additional-details-body">
            <div className="field-grid">
              <BranchSelect branches={branches} selectedBranchId={customer?.branchId} />
              <label>
                <span>Email optional</span>
                <input name="email" type="email" defaultValue={customer?.email ?? ""} />
              </label>
            </div>
            <CustomerNotesFields
              initialNotes={initialNotes}
              notes={customer?.notes}
              preferences={customer?.preferences}
              treatmentNotes={customer?.treatmentNotes}
            />
            {mode === "create" && !isSalonBusiness ? (
              <CustomerVehicleFields initialVehiclePlate={initialVehiclePlate} />
            ) : null}
          </div>
        </details>
      ) : (
        <>
          <CustomerNotesFields
            initialNotes={initialNotes}
            notes={customer?.notes}
            preferences={customer?.preferences}
            treatmentNotes={customer?.treatmentNotes}
          />
          {mode === "create" && !isSalonBusiness ? (
            <CustomerVehicleFields initialVehiclePlate={initialVehiclePlate} />
          ) : null}
        </>
      )}

      <div className="form-actions">
        <button type="submit">
          {mode === "create" ? "Create customer" : "Save customer"}
        </button>
      </div>
    </form>
  );
}

function CustomerNotesFields({
  initialNotes,
  notes,
  preferences,
  treatmentNotes,
}: {
  initialNotes: string;
  notes?: string | null;
  preferences?: string | null;
  treatmentNotes?: string | null;
}) {
  return (
    <>
      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} defaultValue={notes ?? initialNotes} />
      </label>
      <div className="field-grid">
        <label>
          <span>Preferences optional</span>
          <textarea
            name="preferences"
            rows={3}
            defaultValue={preferences ?? ""}
            placeholder="Preferred stylist, products, or service notes"
          />
        </label>
        <label>
          <span>Treatment notes optional</span>
          <textarea
            name="treatmentNotes"
            rows={3}
            defaultValue={treatmentNotes ?? ""}
            placeholder="Colour formula, treatment history, or sensitivities"
          />
        </label>
      </div>
    </>
  );
}

function CustomerVehicleFields({ initialVehiclePlate }: { initialVehiclePlate: string }) {
  return (
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
  );
}

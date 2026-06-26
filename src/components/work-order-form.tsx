import type { Service, Vehicle, Customer } from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

type VehicleWithCustomer = Vehicle & {
  customer: Customer;
};

type WorkOrderFormProps = {
  action: (formData: FormData) => Promise<void>;
  vehicle: VehicleWithCustomer;
  services: Service[];
  branches?: BranchOption[];
};

export function WorkOrderForm({
  action,
  vehicle,
  services,
  branches = [],
}: WorkOrderFormProps) {
  return (
    <form action={action} className="form">
      <input type="hidden" name="vehicleId" value={vehicle.id} />
      <BranchSelect branches={branches} selectedBranchId={vehicle.branchId} />

      <div className="grid">
        <div className="panel metric">
          <span>Registered owner</span>
          <strong style={{ fontSize: 16 }}>{vehicle.customer.name}</strong>
          <span>{vehicle.customer.phone}</span>
        </div>
        <div className="panel metric">
          <span>Vehicle</span>
          <strong style={{ fontSize: 16 }}>{vehicle.plateNumber}</strong>
          <span>
            {[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") ||
              "No vehicle details"}
          </span>
        </div>
      </div>

      <section className="subsection">
        <h3>Today contact / ownership</h3>
        <div className="option-card-list">
          <label className="option-card">
            <input
              type="radio"
              name="contactType"
              value="REGISTERED_OWNER"
              defaultChecked
            />
            <span>
              <strong>Registered owner</strong>
              <small>{vehicle.customer.name} is sending or picking up the vehicle.</small>
            </span>
          </label>
          <label className="option-card">
            <input type="radio" name="contactType" value="OTHER_PERSON" />
            <span>
              <strong>Other person / representative</strong>
              <small>Keep current owner, but send this job WhatsApp to another person.</small>
            </span>
          </label>
          <label className="option-card">
            <input type="radio" name="contactType" value="NEW_OWNER" />
            <span>
              <strong>New owner / vehicle transferred</strong>
              <small>Transfer the vehicle to a new owner for this and future jobs.</small>
            </span>
          </label>
        </div>

        <div className="field-grid">
          <label>
            <span>Other person name</span>
            <input name="contactName" />
          </label>
          <label>
            <span>Other person phone</span>
            <input name="contactPhone" />
          </label>
          <label>
            <span>New owner name</span>
            <input name="newOwnerName" />
          </label>
          <label>
            <span>New owner phone</span>
            <input name="newOwnerPhone" />
          </label>
        </div>

        <label>
          <span>Ownership transfer notes optional</span>
          <textarea name="ownershipNotes" rows={2} />
        </label>
      </section>

      <section className="subsection">
        <h3>Services</h3>
        <div className="service-picker">
          {services.map((service) => (
            <label className="checkbox-row" key={service.id}>
              <input type="checkbox" name="serviceIds" value={service.id} />
              <span>
                <strong>{service.name}</strong>
                <small>{Number(service.price).toFixed(2)}</small>
              </span>
              <input
                aria-label={`${service.name} quantity`}
                name={`quantity_${service.id}`}
                type="number"
                min="1"
                defaultValue="1"
              />
            </label>
          ))}
        </div>
      </section>

      <label>
        <span>Notes optional</span>
        <textarea name="notes" rows={3} />
      </label>

      <div className="form-actions">
        <button type="submit">Create work order</button>
      </div>
    </form>
  );
}

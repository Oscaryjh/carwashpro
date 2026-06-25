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
          <span>Customer</span>
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

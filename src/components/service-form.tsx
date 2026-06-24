import type { Service } from "@prisma/client";

type ServiceFormProps = {
  action: (formData: FormData) => Promise<void>;
  service?: Service;
  submitLabel: string;
};

export function ServiceForm({ action, service, submitLabel }: ServiceFormProps) {
  return (
    <form action={action} className="form">
      {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={service?.name ?? ""} required />
        </label>
        <label>
          <span>Price</span>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
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
      <label>
        <span>Description optional</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={service?.description ?? ""}
        />
      </label>
      <div className="form-actions">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

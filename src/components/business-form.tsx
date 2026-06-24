import type { Business, BusinessStatus } from "@prisma/client";

type BusinessFormProps = {
  action: (formData: FormData) => Promise<void>;
  business?: Business;
  mode: "create" | "edit";
  canEditStatus?: boolean;
  showOwnerFields?: boolean;
};

export function BusinessForm({
  action,
  business,
  mode,
  canEditStatus = false,
  showOwnerFields = false,
}: BusinessFormProps) {
  const status = business?.status ?? "active";

  return (
    <form action={action} className="form">
      {business ? <input type="hidden" name="businessId" value={business.id} /> : null}

      <div className="field-grid">
        <label>
          <span>Business name</span>
          <input name="name" defaultValue={business?.name} required />
        </label>
        <label>
          <span>Business slug</span>
          <input
            name="slug"
            defaultValue={business?.slug ?? ""}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
            disabled={mode === "edit"}
          />
          {mode === "edit" ? (
            <input type="hidden" name="slug" value={business?.slug ?? ""} />
          ) : null}
        </label>
        <label>
          <span>Phone optional</span>
          <input name="phone" defaultValue={business?.phone ?? ""} />
        </label>
        {mode === "edit" ? (
          <>
            <label>
              <span>Email</span>
              <input name="email" type="email" defaultValue={business?.email ?? ""} />
            </label>
            <label>
              <span>Status</span>
              {canEditStatus ? (
                <select name="status" defaultValue={status}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              ) : (
                <>
                  <input type="hidden" name="status" value={status} />
                  <input value={formatStatus(status)} disabled />
                </>
              )}
            </label>
          </>
        ) : null}
      </div>

      {mode === "edit" ? (
        <label>
          <span>Address</span>
          <textarea name="address" defaultValue={business?.address ?? ""} rows={3} />
        </label>
      ) : null}

      {showOwnerFields ? (
        <section className="subsection">
          <div>
            <h3>Owner account</h3>
            <p>Create the first business owner login for this tenant.</p>
          </div>
          <div className="field-grid">
            <label>
              <span>Owner name</span>
              <input name="ownerName" required />
            </label>
            <label>
              <span>Owner email</span>
              <input name="ownerEmail" type="email" required />
            </label>
            <label>
              <span>Owner password</span>
              <input name="ownerPassword" type="password" minLength={8} required />
            </label>
          </div>
        </section>
      ) : null}

      <div className="form-actions">
        <button type="submit">{mode === "create" ? "Create business" : "Save changes"}</button>
      </div>
    </form>
  );
}

function formatStatus(status: BusinessStatus) {
  return status === "active" ? "Active" : "Inactive";
}

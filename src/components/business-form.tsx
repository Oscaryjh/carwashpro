import type { Business, BusinessStatus } from "@prisma/client";
import {
  BusinessLogoUpload,
  BusinessSubmitButton,
} from "@/components/business-logo-upload";
import { BusinessTaxFields } from "@/components/business-tax-fields";
import {
  BUSINESS_INDUSTRY_OPTIONS,
  getBusinessIndustryLabel,
} from "@/lib/business-industry";

type BusinessFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  business?: Business;
  mode: "create" | "edit";
  canEditStatus?: boolean;
  showOwnerFields?: boolean;
  settingsLayout?: boolean;
  formError?: string;
  fieldErrors?: Record<string, string | undefined>;
};

export function BusinessForm({
  action,
  business,
  mode,
  canEditStatus = false,
  showOwnerFields = false,
  settingsLayout = false,
  formError,
  fieldErrors = {},
}: BusinessFormProps) {
  const status = business?.status ?? "active";

  if (settingsLayout && mode === "edit" && business) {
    return (
      <form action={action} className="company-settings-form">
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="slug" value={business.slug} />
        <input type="hidden" name="status" value={status} />

        {formError ? (
          <p className="form-error" role="alert" aria-live="polite">
            {formError}
          </p>
        ) : null}

        <header className="company-settings-hero">
          <div className="company-settings-hero-topline">
            <div>
              <span className="company-settings-eyebrow">Company settings</span>
              <h1>Branding &amp; profile</h1>
            </div>
            <div className="company-settings-save">
              <BusinessSubmitButton idleLabel="Save changes" />
            </div>
          </div>

          <div className="company-settings-identity">
            <BusinessLogoUpload
              businessName={business.name}
              currentLogoUrl={business.logoUrl}
              variant="hero"
            />
            <div>
              <h2>{business.name}</h2>
              <p>
                {getBusinessIndustryLabel(business.industryType)}
                <span aria-hidden="true"> · </span>
                {formatStatus(status)}
              </p>
            </div>
          </div>
        </header>

        <nav className="company-settings-tabs" aria-label="Company settings sections">
          <a href="#company-profile">Company profile</a>
          <a href="#company-tax">Tax &amp; invoice</a>
        </nav>

        <section className="company-settings-sheet" id="company-profile">
          <div className="company-settings-section-heading">
            <div>
              <span className="company-settings-eyebrow">Company</span>
              <h2>Business details</h2>
            </div>
            <p>Information used across invoices, receipts and customer records.</p>
          </div>

          <div className="company-settings-field-grid">
            <label>
              <span>Company name</span>
              <input
                name="name"
                defaultValue={business.name}
                required
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? "business-name-error" : undefined}
              />
              <FieldError id="business-name-error" message={fieldErrors.name} />
            </label>
            <label>
              <span>Company registration no.</span>
              <input
                name="companyNo"
                defaultValue={business.companyNo ?? ""}
                placeholder="Optional"
              />
            </label>
            <label>
              <span>Phone</span>
              <input
                name="phone"
                defaultValue={business.phone ?? ""}
                placeholder="Optional"
              />
            </label>
            <label>
              <span>Email</span>
              <input
                name="email"
                type="email"
                defaultValue={business.email ?? ""}
                placeholder="Optional"
              />
            </label>
            <label>
              <span>Industry</span>
              <input
                value={getBusinessIndustryLabel(business.industryType)}
                disabled
              />
            </label>
            <label>
              <span>Company URL</span>
              <input value={business.slug} disabled />
            </label>
            <label className="company-settings-address-field">
              <span>Address</span>
              <textarea
                name="address"
                defaultValue={business.address ?? ""}
                rows={3}
                placeholder="Company or head office address"
              />
            </label>
          </div>
        </section>

        <section className="company-settings-sheet" id="company-tax">
          <div className="company-settings-section-heading">
            <div>
              <span className="company-settings-eyebrow">Tax &amp; invoice</span>
              <h2>Tax settings</h2>
            </div>
            <p>Applied to every industry and active branch in this company.</p>
          </div>
          <BusinessTaxFields
            initialEnabled={business.sstEnabled}
            initialLabel={business.sstLabel ?? "SST"}
            initialRate={business.sstRate?.toString() ?? "0"}
            initialRegistrationNo={business.sstRegistrationNo ?? ""}
          />
        </section>

        <div className="company-settings-bottom-save">
          <BusinessSubmitButton idleLabel="Save changes" />
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="form">
      {business ? <input type="hidden" name="businessId" value={business.id} /> : null}
      {formError ? (
        <p className="form-error" role="alert" aria-live="polite">
          {formError}
        </p>
      ) : null}

      <div className="field-grid">
        <label>
          <span>Company name</span>
          <input
            name="name"
            defaultValue={business?.name}
            required
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "business-name-error" : undefined}
          />
          <FieldError id="business-name-error" message={fieldErrors.name} />
        </label>
        <label>
          <span>Company slug</span>
          <input
            name="slug"
            defaultValue={business?.slug ?? ""}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
            disabled={mode === "edit"}
            aria-invalid={Boolean(fieldErrors.slug)}
            aria-describedby={fieldErrors.slug ? "business-slug-error" : undefined}
          />
          <FieldError id="business-slug-error" message={fieldErrors.slug} />
          {mode === "edit" ? (
            <input type="hidden" name="slug" value={business?.slug ?? ""} />
          ) : null}
        </label>
        <label>
          <span>Industry</span>
          {mode === "create" ? (
            <select name="industryType" defaultValue="AUTO_DETAILING" required>
              {BUSINESS_INDUSTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={getBusinessIndustryLabel(
                business?.industryType ?? "AUTO_DETAILING",
              )}
              disabled
            />
          )}
          <FieldError id="business-industry-error" message={fieldErrors.industryType} />
        </label>
        <label>
          <span>Company No. optional</span>
          <input
            name="companyNo"
            defaultValue={business?.companyNo ?? ""}
            placeholder="Company registration no."
          />
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
        <>
          <section className="subsection">
            <div>
              <h3>Company logo</h3>
              <p>This logo appears in the sidebar and can be reused for invoices later.</p>
            </div>
            <BusinessLogoUpload
              businessName={business?.name ?? "Company"}
              currentLogoUrl={business?.logoUrl}
            />
          </section>
          <label>
            <span>Address</span>
            <textarea name="address" defaultValue={business?.address ?? ""} rows={3} />
          </label>
          <section className="subsection">
            <div>
              <h3>Tax settings</h3>
              <p>These settings apply to every industry and branch in this company.</p>
            </div>
            <BusinessTaxFields
              initialEnabled={business?.sstEnabled ?? false}
              initialLabel={business?.sstLabel ?? "SST"}
              initialRate={business?.sstRate?.toString() ?? "0"}
              initialRegistrationNo={business?.sstRegistrationNo ?? ""}
            />
          </section>
        </>
      ) : null}

      {showOwnerFields ? (
        <section className="subsection">
          <div>
            <h3>Owner account</h3>
            <p>Create the first owner login for this company.</p>
          </div>
          <div className="field-grid">
            <label>
              <span>Owner name</span>
              <input
                name="ownerName"
                required
                aria-invalid={Boolean(fieldErrors.ownerName)}
                aria-describedby={fieldErrors.ownerName ? "owner-name-error" : undefined}
              />
              <FieldError id="owner-name-error" message={fieldErrors.ownerName} />
            </label>
            <label>
              <span>Login email</span>
              <input
                name="ownerEmail"
                type="email"
                required
                aria-invalid={Boolean(fieldErrors.ownerEmail)}
                aria-describedby={fieldErrors.ownerEmail ? "owner-email-error" : undefined}
              />
              <FieldError id="owner-email-error" message={fieldErrors.ownerEmail} />
            </label>
            <label>
              <span>Login password</span>
              <input
                name="ownerPassword"
                type="password"
                minLength={8}
                required
                aria-invalid={Boolean(fieldErrors.ownerPassword)}
                aria-describedby={
                  fieldErrors.ownerPassword ? "owner-password-error" : undefined
                }
              />
              <FieldError
                id="owner-password-error"
                message={fieldErrors.ownerPassword}
              />
            </label>
          </div>
        </section>
      ) : null}

      <div className="form-actions">
        <BusinessSubmitButton
          idleLabel={mode === "create" ? "Create company" : "Save changes"}
        />
      </div>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="field-error" id={id}>
      {message}
    </span>
  ) : null;
}

function formatStatus(status: BusinessStatus) {
  return status === "active" ? "Active" : "Inactive";
}

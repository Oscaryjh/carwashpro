import type { Business, BusinessStatus } from "@prisma/client";
import type { ReactNode } from "react";
import {
  BusinessLogoUpload,
  BusinessSubmitButton,
} from "@/components/business-logo-upload";
import { BusinessTaxFields } from "@/components/business-tax-fields";
import { BusinessDayStartField } from "@/components/business-day-start-field";
import {
  CompanySettingsDialog,
  CompanySettingsDialogFooter,
  CompanySettingsDialogTrigger,
} from "@/components/company-settings-dialog";
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
  attendanceLocations?: ReactNode;
  workspaceLayout?: boolean;
  openClockInLocation?: boolean;
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
  attendanceLocations,
  workspaceLayout = false,
  openClockInLocation = false,
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
          <CompanySettingsDialogTrigger
            dialogId="company-profile-dialog"
            index="01"
            label="Company profile"
            description="Business identity and contact"
          />
          <CompanySettingsDialogTrigger
            dialogId="business-day-dialog"
            index="02"
            label="Business day"
            description="Time zone and reporting day"
          />
          <CompanySettingsDialogTrigger
            dialogId="company-tax-dialog"
            index="03"
            label="Tax & invoice"
            description="SST and invoice details"
          />
          <CompanySettingsDialogTrigger
            dialogId="payment-methods-dialog"
            index="04"
            label="Payment methods"
            description="Checkout buttons and reporting"
          />
          <CompanySettingsDialogTrigger
            dialogId="cashier-operations-dialog"
            index="05"
            label="Cashier operations"
            description="Cashier shift tracking"
          />
        </nav>

        <CompanySettingsDialog
          id="company-profile-dialog"
          initiallyOpen={openClockInLocation}
          eyebrow="Company profile"
          title="Business details"
          description="Information used across invoices, receipts and customer records."
        >
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
          {attendanceLocations}
          <CompanySettingsDialogFooter>
            {attendanceLocations && <p className="company-profile-save-note">Saves company profile changes only. Save clock-in location separately.</p>}
            <BusinessSubmitButton idleLabel="Save company changes" />
          </CompanySettingsDialogFooter>
        </CompanySettingsDialog>

        <CompanySettingsDialog
          id="business-day-dialog"
          eyebrow="Operations"
          title="Business day"
          description="Choose when Tetamu POS starts a new reporting day."
        >
          <div className="company-settings-field-grid">
            <BusinessTimezoneField timezone={business.timezone} reportingDay />
            <BusinessDayStartField initialTime={business.businessDayCutoffTime} />
          </div>
          <p className="business-day-info"><span aria-hidden="true">ⓘ </span>This does not change your store opening hours.</p>
          <CompanySettingsDialogFooter>
            <BusinessSubmitButton idleLabel="Save changes" />
          </CompanySettingsDialogFooter>
        </CompanySettingsDialog>

        <CompanySettingsDialog
          id="company-tax-dialog"
          eyebrow="Tax & invoice"
          title="Tax settings"
          description="Applied to every industry and active branch in this company."
        >
          <BusinessTaxFields
            initialEnabled={business.sstEnabled}
            initialLabel={business.sstLabel ?? "SST"}
            initialRate={business.sstRate?.toString() ?? "0"}
            initialRegistrationNo={business.sstRegistrationNo ?? ""}
          />
          <CompanySettingsDialogFooter>
            <BusinessSubmitButton idleLabel="Save changes" />
          </CompanySettingsDialogFooter>
        </CompanySettingsDialog>
      </form>
    );
  }

  return (
    <form action={action} className="form">
      {mode === "create" ? <p>One Business represents one physical store or outlet, with its own login and records.</p> : null}
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
            <BusinessTimezoneField
              timezone={business?.timezone ?? "Asia/Kuching"}
            />
            <label>
              <span>Business day cutoff</span>
              <input
                name="businessDayCutoffTime"
                type="time"
                defaultValue={business?.businessDayCutoffTime ?? "02:00"}
                required
              />
            </label>
          </>
        ) : null}
      </div>

      {mode === "create" ? (
        <label>
          <span>Business address (optional)</span>
          <textarea name="address" rows={3} placeholder="Store or outlet address" />
          <small>Address only. Clock-in location is configured separately in HR settings.</small>
        </label>
      ) : null}

      {mode === "edit" ? (
        <details open={workspaceLayout ? undefined : true}>
          <summary hidden={!workspaceLayout}>Additional settings · logo, address and tax</summary>
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
        </details>
      ) : null}

      {showOwnerFields ? (
        <section className="subsection">
          <div>
            <h3>Owner account</h3>
            <p>Create a separate owner login for this store. Access to other businesses requires an explicit Business Group grant.</p>
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
                minLength={6}
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
        {workspaceLayout && <button type="reset" data-workspace-discard className="secondary-light-button">Discard</button>}
        <BusinessSubmitButton
          idleLabel={mode === "create" ? "Create business" : "Save changes"}
        />
      </div>
    </form>
  );
}

function BusinessTimezoneField({ timezone, reportingDay = false }: { timezone: string; reportingDay?: boolean }) {
  const isMalaysiaTimezone =
    timezone === "Asia/Kuching" || timezone === "Asia/Kuala_Lumpur";

  return (
    <label>
      <span>Time zone</span>
      <select
        name="timezone"
        defaultValue={timezone}
        required
        aria-describedby="business-timezone-help"
      >
        {isMalaysiaTimezone ? (
          <option value={timezone}>Malaysia (UTC+8)</option>
        ) : (
          <>
            <option value={timezone}>{timezone} (Current)</option>
            <option value="Asia/Kuala_Lumpur">Malaysia (UTC+8)</option>
          </>
        )}
      </select>
      <small className="field-helper" id="business-timezone-help">
        {reportingDay ? "Used for reports, appointments and shifts." : "Malaysia time is UTC+8. The standard technical time zone is kept internally for accurate schedules and reports."}
      </small>
    </label>
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

import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { MODULE_REGISTRY, moduleKeys } from "@/lib/modules/registry";
import { updateBusinessAction } from "@/app/admin/businesses/actions";
import Link from "next/link";
import { saveBusinessVehicleSizeOverrideAction, removeBusinessVehicleSizeOverrideAction } from "./vehicle-size-actions";
import { formatCents } from "@/lib/commercial/money";
import { getEffectiveCommercialConfiguration } from "@/lib/commercial/service";
import { listSubscriptionInvoices } from "@/lib/commercial/billing-service";
import { getEffectiveBusinessPaymentMethods } from "@/lib/payments/business-methods";
import { CompanySettingsDialog } from "@/components/company-settings-dialog";
import { PaymentMethodsSettings } from "./payment-methods/payment-methods-settings";

type BusinessSettingsPageProps = {
  searchParams: Promise<{
    saved?: string;
    panel?: string;
    message?: string;
    type?: string;
  }>;
};

export default async function BusinessSettingsPage({
  searchParams,
}: BusinessSettingsPageProps) {
  const context = await requireBusinessContext({
    capability: "MODIFY_BUSINESS_SETTINGS",
  });
  assertRole(context.user, ["BUSINESS_OWNER"]);
  const params = await searchParams;

  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });

  const sizeOverrides = await prisma.businessVehicleSizeOverride.findMany({
    where: { businessId: context.businessId },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });
  const moduleContext = await loadBusinessModuleContext(context.businessId);
  const commercial = await getEffectiveCommercialConfiguration({ businessId: context.businessId });
  const subscriptionInvoices = await listSubscriptionInvoices({ actor: context.user, businessId: context.businessId });
  const paymentMethods = await getEffectiveBusinessPaymentMethods(context.businessId);

  if (!business) {
    return (
      <>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="content company-settings-page">
        <div className="company-settings-page-actions">
          <Link className="secondary-link-button" href="/business/settings/logs">
            Staff logs
          </Link>
        </div>

        <BusinessForm
          action={updateBusinessAction}
          mode="edit"
          business={business}
          settingsLayout
        />
        <CompanySettingsDialog
          id="payment-methods-dialog"
          eyebrow="Company settings"
          title="Payment methods"
          description="Choose the payment buttons your team sees at checkout."
          initiallyOpen={params.panel === "payment-methods"}
          size="large"
        >
          {params.panel === "payment-methods" && params.message ? (
            <div className={params.type === "error" ? "error" : "success"}>{params.message}</div>
          ) : null}
          <PaymentMethodsSettings methods={paymentMethods} returnTo="business-settings" />
        </CompanySettingsDialog>
        <div className="company-settings-sheet company-settings-secondary-section" id="modules">
          <div className="company-settings-section-heading">
            <div><span className="company-settings-eyebrow">Product access</span><h2>Modules</h2></div>
            <p>Module entitlement is separate from user permission. Only an authorized platform administrator can change it.</p>
          </div>
          <div className="grid">
            {moduleKeys.filter((key) => MODULE_REGISTRY[key].operational).map((key) => (
              <div className="panel metric" key={key}>
                <span>{MODULE_REGISTRY[key].label}</span>
                <strong>{moduleContext.enabledModules.has(key) ? "Enabled" : "Not enabled"}</strong>
                {MODULE_REGISTRY[key].dependencies.length ? <small>Requires {MODULE_REGISTRY[key].dependencies.join(", ")}</small> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="company-settings-sheet company-settings-secondary-section" id="subscription">
          <div className="company-settings-section-heading"><div><span className="company-settings-eyebrow">Commercial</span><h2>Current plan</h2></div><p>Read-only. Product entitlement and user permissions remain separate.</p></div>
          {commercial.subscription && commercial.allowances ? <div className="grid"><div className="panel metric"><span>Plan</span><strong>{commercial.subscription.items.filter(item => item.status === "ACTIVE").map(item => item.planVersion.plan.displayName).join(" + ")}</strong></div><div className="panel metric"><span>Recurring price</span><strong>{formatCents(commercial.price?.effectiveRecurringPriceCents ?? null)}</strong></div><div className="panel metric"><span>Allowances</span><strong>{commercial.allowances.branches} branches · {commercial.allowances.employees} employees</strong></div><div className="panel metric"><span>Ask Tetamu</span><strong>{commercial.allowances.businessAi} / month</strong></div><div className="panel metric"><span>Next renewal</span><strong>{commercial.subscription.renewalDate.toLocaleDateString("en-MY")}</strong></div></div> : <div className="panel"><strong>Legacy / commercial review required</strong><p>Existing product access is preserved. Missing historical price is not treated as RM0 or a free plan.</p></div>}
          <h3>Billing history</h3><p>Read-only. Subscription price is not proof of payment.</p>{subscriptionInvoices.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Invoice</th><th>Period</th><th>Status</th><th>Total</th><th>Outstanding</th></tr></thead><tbody>{subscriptionInvoices.map(invoice => <tr key={invoice.id}><td>{invoice.invoiceNumber}</td><td>{invoice.billingPeriodStart.toLocaleDateString("en-MY")}–{invoice.billingPeriodEnd.toLocaleDateString("en-MY")}</td><td>{invoice.status === "ISSUED" ? invoice.canonicalPaymentStatus : invoice.status}</td><td>{formatCents(invoice.totalAmountCents)}</td><td>{formatCents(invoice.canonicalOutstandingCents)}</td></tr>)}</tbody></table></div> : <p className="empty-state">No subscription invoices.</p>}
        </div>
        {business.industryType === "AUTO_DETAILING" ? (
          <div className="company-settings-sheet company-settings-secondary-section" id="vehicle-rules">
            <div className="company-settings-section-heading">
              <div>
                <span className="company-settings-eyebrow">Auto detailing</span>
                <h2>Vehicle size rules</h2>
              </div>
              <p>Override the platform default for this business only.</p>
            </div>
            <form action={saveBusinessVehicleSizeOverrideAction} className="form-grid">
              <label>Brand<input name="brand" placeholder="Toyota" required /></label>
              <label>Model<input name="model" placeholder="Vios" required /></label>
              <label>Size<select name="size" defaultValue="MEDIUM"><option value="SMALL">Small</option><option value="MEDIUM">Medium</option><option value="LARGE">Large</option></select></label>
              <button className="primary-button" type="submit">Save rule</button>
            </form>
            {sizeOverrides.length ? <table className="table"><thead><tr><th>Brand</th><th>Model</th><th>Size</th><th /></tr></thead><tbody>{sizeOverrides.map((item) => <tr key={item.id}><td>{item.brand}</td><td>{item.model}</td><td>{item.size}</td><td><form action={removeBusinessVehicleSizeOverrideAction}><input type="hidden" name="id" value={item.id} /><button className="secondary-button" type="submit">Remove</button></form></td></tr>)}</tbody></table> : <p className="empty-state">No business overrides yet.</p>}
          </div>
        ) : null}
      </section>
    </>
  );
}

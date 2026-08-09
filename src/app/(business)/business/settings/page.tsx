import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { updateBusinessAction } from "@/app/admin/businesses/actions";
import Link from "next/link";
import { saveBusinessVehicleSizeOverrideAction, removeBusinessVehicleSizeOverrideAction } from "./vehicle-size-actions";

type BusinessSettingsPageProps = {
  searchParams: Promise<{
    saved?: string;
  }>;
};

export default async function BusinessSettingsPage({
  searchParams,
}: BusinessSettingsPageProps) {
  const context = await requireBusinessContext({
    capability: "MODIFY_BUSINESS_SETTINGS",
  });
  assertRole(context.user, ["BUSINESS_OWNER"]);
  await searchParams;

  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });

  const sizeOverrides = await prisma.businessVehicleSizeOverride.findMany({
    where: { businessId: context.businessId },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

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

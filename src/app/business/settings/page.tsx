import { AppShell } from "@/components/app-shell";
import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { updateBusinessAction } from "@/app/admin/businesses/actions";
import { saveAppointmentReminderSettingsAction } from "./actions";
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
  const context = await requireBusinessContext();
  assertRole(context.user, ["BUSINESS_OWNER"]);
  await searchParams;

  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });

  const sizeOverrides = await prisma.businessVehicleSizeOverride.findMany({
    where: { businessId: context.businessId },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  const appointmentReminderSetting = await prisma.appointmentReminderSetting.findUnique({
    where: { businessId: context.businessId },
  });

  if (!business) {
    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Company settings</h1>
            <p>Manage your company profile.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/business/settings/logs">
              Staff logs
            </Link>
          </div>
        </div>

        <div className="panel">
          <BusinessForm
            action={updateBusinessAction}
            mode="edit"
            business={business}
          />
        </div>
        {business.industryType === "AUTO_DETAILING" ? (
          <div className="panel">
            <h2>Vehicle size rules</h2>
            <p className="muted">Override the platform default for this business only.</p>
            <form action={saveBusinessVehicleSizeOverrideAction} className="form-grid">
              <label>Brand<input name="brand" placeholder="Toyota" required /></label>
              <label>Model<input name="model" placeholder="Vios" required /></label>
              <label>Size<select name="size" defaultValue="MEDIUM"><option value="SMALL">Small</option><option value="MEDIUM">Medium</option><option value="LARGE">Large</option></select></label>
              <button className="primary-button" type="submit">Save rule</button>
            </form>
            {sizeOverrides.length ? <table className="table"><thead><tr><th>Brand</th><th>Model</th><th>Size</th><th /></tr></thead><tbody>{sizeOverrides.map((item) => <tr key={item.id}><td>{item.brand}</td><td>{item.model}</td><td>{item.size}</td><td><form action={removeBusinessVehicleSizeOverrideAction}><input type="hidden" name="id" value={item.id} /><button className="secondary-button" type="submit">Remove</button></form></td></tr>)}</tbody></table> : <p className="empty-state">No business overrides yet.</p>}
          </div>
        ) : null}
        <div className="panel">
          <div className="section-heading">
            <div>
              <h2>Appointment reminders</h2>
              <p className="muted">Send WhatsApp reminders automatically before scheduled appointments.</p>
            </div>
            <Link className="secondary-link-button" href="/whatsapp/queue">View send logs</Link>
          </div>
          <form action={saveAppointmentReminderSettingsAction} className="form-grid appointment-reminder-settings">
            <label className="checkbox-row">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={appointmentReminderSetting?.enabled ?? true}
              />
              <span>
                Send appointment reminders
                <small>Customers receive a WhatsApp reminder before their appointment.</small>
              </span>
            </label>
            <label>
              Send reminder
              <select
                name="leadTimeMinutes"
                defaultValue={String(appointmentReminderSetting?.leadTimeMinutes ?? 1440)}
              >
                <option value="15">15 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="120">2 hours before</option>
                <option value="1440">24 hours before</option>
                <option value="2880">48 hours before</option>
              </select>
            </label>
            <p className="form-help">Failed reminders are retried automatically. Check the send logs to view their delivery status.</p>
            <button className="primary-button" type="submit">Save settings</button>
          </form>
        </div>
      </section>
    </AppShell>
  );
}

import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createVehicleSizeDefaultAction, deactivateVehicleSizeDefaultAction } from "./actions";

export default async function VehicleSizeDefaultsPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const defaults = await prisma.vehicleModelSizeDefault.findMany({
    where: { active: true },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div><h1>Vehicle size defaults</h1><p>Set the platform default size for each vehicle model.</p></div></div>
        <div className="panel">
          <form action={createVehicleSizeDefaultAction} className="form-grid">
            <label>Brand<input name="brand" placeholder="Perodua" required /></label>
            <label>Model<input name="model" placeholder="Myvi" required /></label>
            <label>Default size<select name="size" defaultValue="MEDIUM"><option value="SMALL">Small</option><option value="MEDIUM">Medium</option><option value="LARGE">Large</option></select></label>
            <button className="primary-button" type="submit">Save default</button>
          </form>
        </div>
        <div className="panel"><h2>Active defaults</h2>
          {defaults.length ? <table className="table"><thead><tr><th>Brand</th><th>Model</th><th>Size</th><th /></tr></thead><tbody>{defaults.map((item) => <tr key={item.id}><td>{item.brand}</td><td>{item.model}</td><td>{item.size}</td><td><form action={deactivateVehicleSizeDefaultAction}><input type="hidden" name="id" value={item.id} /><button className="secondary-button" type="submit">Deactivate</button></form></td></tr>)}</tbody></table> : <p className="empty-state">No defaults configured yet.</p>}
        </div>
      </section>
    </AppShell>
  );
}

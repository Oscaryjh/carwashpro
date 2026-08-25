import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  createVehicleSizeDefaultAction,
  deactivateVehicleSizeDefaultAction,
} from "./actions";
import styles from "../admin-directory.module.css";

export default async function VehicleSizeDefaultsPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const defaults = await prisma.vehicleModelSizeDefault.findMany({
    where: { active: true },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });
  const brandCount = new Set(
    defaults.map((item) => item.brand.toLocaleLowerCase()),
  ).size;
  const sizeCounts = defaults.reduce<Record<string, number>>((counts, item) => {
    counts[item.size] = (counts[item.size] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <AppShell user={user}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Vehicle configuration</p>
            <h1>Vehicle size defaults</h1>
            <p className={styles.heroDescription}>
              Set the size automatically suggested when a vehicle model is
              added. Staff can still correct the size when needed.
            </p>
          </div>
        </header>
        <section
          className={styles.metrics}
          aria-label="Vehicle default summary"
        >
          <article className={styles.metric}>
            <span>Configured models</span>
            <strong>{defaults.length}</strong>
            <small>Active platform defaults</small>
          </article>
          <article className={styles.metric}>
            <span>Brands</span>
            <strong>{brandCount}</strong>
            <small>With at least one model</small>
          </article>
          <article className={styles.metric}>
            <span>Small / Medium</span>
            <strong>
              {sizeCounts.SMALL ?? 0} / {sizeCounts.MEDIUM ?? 0}
            </strong>
            <small>Configured models</small>
          </article>
          <article className={styles.metric}>
            <span>Large</span>
            <strong>{sizeCounts.LARGE ?? 0}</strong>
            <small>Configured models</small>
          </article>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Add or update a default</h2>
              <p>
                Saving the same brand and model updates the suggested size
                without changing existing vehicles.
              </p>
            </div>
          </div>
          <form
            action={createVehicleSizeDefaultAction}
            className={`${styles.sizeForm} ${styles.panelBody}`}
          >
            <label className={styles.field}>
              <span>Brand</span>
              <input name="brand" placeholder="e.g. Perodua" required />
            </label>
            <label className={styles.field}>
              <span>Model</span>
              <input name="model" placeholder="e.g. Myvi" required />
            </label>
            <label className={styles.field}>
              <span>Suggested size</span>
              <select name="size" defaultValue="MEDIUM">
                <option value="SMALL">Small</option>
                <option value="MEDIUM">Medium</option>
                <option value="LARGE">Large</option>
              </select>
            </label>
            <button type="submit">Save default</button>
          </form>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Active defaults</h2>
              <p>
                These suggestions are available when staff add matching vehicle
                models.
              </p>
            </div>
            <span className={styles.countBadge}>{defaults.length} models</span>
          </div>
          {defaults.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th>Model</th>
                    <th>Suggested size</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {defaults.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.brand}</strong>
                      </td>
                      <td>{item.model}</td>
                      <td>
                        <span className={styles.sizePill}>
                          {formatSize(item.size)}
                        </span>
                      </td>
                      <td>
                        <form action={deactivateVehicleSizeDefaultAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            className={styles.deactivateButton}
                            type="submit"
                          >
                            Remove default
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.emptyState}>
              No defaults configured yet. Add the first model above.
            </p>
          )}
        </section>
      </section>
    </AppShell>
  );
}

function formatSize(size: string) {
  return size.charAt(0) + size.slice(1).toLocaleLowerCase();
}

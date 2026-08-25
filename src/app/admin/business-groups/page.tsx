import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BusinessGroupCreateModal } from "@/components/business-group-create-modal";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createBusinessGroupAction } from "./actions";
import styles from "../admin-directory.module.css";

export default async function BusinessGroupsPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const groups = await prisma.businessGroup.findMany({
    include: {
      _count: {
        select: {
          members: { where: { status: "ACTIVE" } },
          users: { where: { status: "ACTIVE" } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const activeGroups = groups.filter(
    (group) => group.status === "ACTIVE",
  ).length;
  const groupedBusinesses = groups.reduce(
    (sum, group) => sum + group._count.members,
    0,
  );
  const groupUsers = groups.reduce((sum, group) => sum + group._count.users, 0);

  return (
    <AppShell user={user}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Platform administration</p>
            <h1>Business groups</h1>
            <p className={styles.heroDescription}>
              Group related businesses for consolidated access and reporting
              without changing each business&apos;s data ownership.
            </p>
          </div>
          <div className={styles.heroActions}>
            <BusinessGroupCreateModal action={createBusinessGroupAction} />
          </div>
        </header>

        <section className={styles.metrics} aria-label="Business group summary">
          <article className={styles.metric}>
            <span>All groups</span>
            <strong>{groups.length}</strong>
            <small>Configured on the platform</small>
          </article>
          <article className={styles.metric}>
            <span>Active groups</span>
            <strong>{activeGroups}</strong>
            <small>Available for access</small>
          </article>
          <article className={styles.metric}>
            <span>Businesses assigned</span>
            <strong>{groupedBusinesses}</strong>
            <small>Active memberships</small>
          </article>
          <article className={styles.metric}>
            <span>Group users</span>
            <strong>{groupUsers}</strong>
            <small>Active user access</small>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Group directory</h2>
              <p>Open a group to manage its businesses and authorized users.</p>
            </div>
            <span className={styles.countBadge}>
              {groups.length} group{groups.length === 1 ? "" : "s"}
            </span>
          </div>
          {groups.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Businesses</th>
                    <th>Group users</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.id}>
                      <td>
                        <strong>{group.name}</strong>
                      </td>
                      <td>{group.code}</td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${group.status === "ACTIVE" ? "" : styles.statusBadgeInactive}`}
                        >
                          {group.status === "ACTIVE" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>{group._count.members}</td>
                      <td>{group._count.users}</td>
                      <td>
                        <Link
                          className={styles.rowAction}
                          href={`/admin/business-groups/${group.id}`}
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.emptyState}>
              No business groups yet. Create one when multiple businesses need
              shared access or reporting.
            </p>
          )}
        </section>
      </section>
    </AppShell>
  );
}

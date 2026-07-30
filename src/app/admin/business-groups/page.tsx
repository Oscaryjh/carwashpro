import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BusinessGroupCreateModal } from "@/components/business-group-create-modal";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createBusinessGroupAction } from "./actions";

export default async function BusinessGroupsPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const groups = await prisma.businessGroup.findMany({
    include: {
      _count: { select: { members: { where: { status: "ACTIVE" } }, users: { where: { status: "ACTIVE" } } } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Business groups</h1>
            <p>Organize independent businesses for future multi-store management and reporting.</p>
          </div>
          <BusinessGroupCreateModal action={createBusinessGroupAction} />
        </div>

        <section className="panel">
          <div className="section-header">
            <div>
              <h2>All groups</h2>
              <p className="muted">Only Platform Admin can change group membership or access.</p>
            </div>
          </div>
          {groups.length ? (
            <table className="table">
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
                    <td><strong>{group.name}</strong></td>
                    <td>{group.code}</td>
                    <td><span className={`status ${group.status.toLowerCase()}`}>{group.status.toLowerCase()}</span></td>
                    <td>{group._count.members}</td>
                    <td>{group._count.users}</td>
                    <td><Link href={`/admin/business-groups/${group.id}`}>Manage</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No business groups yet.</p>
          )}
        </section>
      </section>
    </AppShell>
  );
}

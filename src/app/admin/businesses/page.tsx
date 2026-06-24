import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function BusinessesPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const businesses = await prisma.business.findMany({
    include: {
      _count: {
        select: { users: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Businesses</h1>
            <p>Create and manage car wash tenants.</p>
          </div>
          <Link className="button-link" href="/admin/businesses/new">
            Create Business
          </Link>
        </div>

        <div className="panel">
          <h2>All businesses</h2>
          {businesses.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Users</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {businesses.map((business) => (
                  <tr key={business.id}>
                    <td>
                      <strong>{business.name}</strong>
                      <div className="muted">{business.slug}</div>
                    </td>
                    <td>
                      <div>{business.phone || "No phone"}</div>
                      <div className="muted">{business.email || "No email"}</div>
                    </td>
                    <td>
                      <span className={`status ${business.status}`}>
                        {business.status}
                      </span>
                    </td>
                    <td>{business._count.users}</td>
                    <td>{business.createdAt.toLocaleDateString()}</td>
                    <td>
                      <Link href={`/admin/businesses/${business.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No businesses yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

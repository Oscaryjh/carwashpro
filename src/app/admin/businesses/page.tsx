import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBusinessIndustryLabel } from "@/lib/business-industry";

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
            <p>Create and manage companies across supported industries.</p>
          </div>
          <Link className="button-link" href="/admin/businesses/new">
            Create Company
          </Link>
        </div>

        <div className="panel">
          <h2>All companies</h2>
          {businesses.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Company No.</th>
                  <th>Industry</th>
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
                    <td>{business.companyNo || "No company no."}</td>
                    <td>{getBusinessIndustryLabel(business.industryType)}</td>
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
            <p className="empty-state">No companies yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

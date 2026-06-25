import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export default async function BranchesPage() {
  const { user, businessId } = await requireBusinessUser();
  const branches = await prisma.branch.findMany({
    where: { businessId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Branches</h1>
            <p>Manage locations under this business.</p>
          </div>
          {user.role === "BUSINESS_OWNER" ? (
            <Link className="button-link" href="/branches/new">
              New Branch
            </Link>
          ) : null}
        </div>

        <div className="panel">
          {branches.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id}>
                    <td>{branch.name}</td>
                    <td>{branch.phone || "No phone"}</td>
                    <td>{branch.address || "No address"}</td>
                    <td>{formatStatus(branch.status)}</td>
                    <td>
                      <Link href={`/branches/${branch.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No branches yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

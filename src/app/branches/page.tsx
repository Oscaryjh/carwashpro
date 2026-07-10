import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type BranchesPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function BranchesPage({ searchParams }: BranchesPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "BRANCHES");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const branches = await prisma.branch.findMany({
    where: {
      businessId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { phone: { contains: query, mode: "insensitive" as const } },
              { address: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
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
          <Link className="button-link" href="/branches/new">
            New Branch
          </Link>
        </div>

        <div className="panel">
          <form className="search-form branch-search-form" action="/branches">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search branch name, phone, or address"
            />
            <button type="submit">Search</button>
            {query ? (
              <Link className="secondary-light-button clear-filter-link" href="/branches">
                Clear
              </Link>
            ) : null}
          </form>
          {branches.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {branches.map((branch, index) => (
                  <tr key={branch.id}>
                    <td className="table-number">{index + 1}</td>
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
            <p className="empty-state">
              {query ? "No branches match this search." : "No branches yet."}
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

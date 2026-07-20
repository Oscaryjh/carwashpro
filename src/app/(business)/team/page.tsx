import Link from "next/link";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

type TeamPageProps = {
  searchParams: Promise<{
    message?: string;
    q?: string;
    type?: string;
  }>;
};

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

  const params = await searchParams;
  const message = params.message;
  const messageType = params.type === "error" ? "error" : "success";
  const query = params.q?.trim() ?? "";
  const [staff, branches] = await Promise.all([
    prisma.user.findMany({
      where: {
        businessId,
        role: "STAFF",
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
                { whatsappPhone: { contains: query, mode: "insensitive" as const } },
                { branch: { name: { contains: query, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: {
        branch: {
          select: { id: true, name: true },
        },
        employeeAccount: {
          include: {
            memberships: {
              where: { businessId },
              include: {
                branchAssignments: {
                  include: { branch: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getActiveBranches(businessId),
  ]);

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Team & Permissions</h1>
            <p>Manage staff accounts, branch assignment, and access permissions.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-light-button" href="/team/attendance">
              Attendance
            </Link>
            <Link className="button-link" href="/team/new">
              Create staff
            </Link>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        {!branches.length ? (
          <div className="warning">
            No active branch is available. Contact the platform administrator to
            provision or reactivate a branch before adding staff.
          </div>
        ) : null}

        <div className="panel">
          <form className="search-form team-search-form" action="/team">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search name, email, phone, or branch"
            />
            <button type="submit">Search</button>
            {query ? (
              <Link className="secondary-light-button clear-filter-link" href="/team">
                Clear
              </Link>
            ) : null}
          </form>
          <div className="section-header">
            <h2>Staff accounts</h2>
            <span className="status">{staff.length} staff</span>
          </div>
          {staff.length ? (
            <table className="table team-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Name</th>
                  <th>Email / Login ID</th>
                  <th>Branch</th>
                  <th>Permissions</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {staff.map((staffUser, index) => (
                  <tr key={staffUser.id}>
                    <td className="table-number">{index + 1}</td>
                    <td>
                      <strong>{staffUser.name}</strong>
                      {staffUser.whatsappPhone ? (
                        <span className="muted">{staffUser.whatsappPhone}</span>
                      ) : null}
                    </td>
                    <td>{staffUser.loginEnabled ? staffUser.email : "No system login"}</td>
                    <td>
                      {(() => {
                        const assignedBranches = staffUser.employeeAccount?.memberships
                          .flatMap((membership) => membership.branchAssignments.map((assignment) => assignment.branch))
                          .filter((branch, index, all) => all.findIndex((item) => item.id === branch.id) === index) ?? [];
                        const names = assignedBranches.length
                          ? assignedBranches.map((branch) => branch.name)
                          : staffUser.branch?.name
                            ? [staffUser.branch.name]
                            : [];
                        return names.length ? names.join(", ") : "No branch";
                      })()}
                    </td>
                    <td>
                      {staffUser.loginEnabled
                        ? `${staffUser.permissions.length} permissions`
                        : "Staff record only"}
                    </td>
                    <td>
                      <span className="status">{staffUser.status}</span>
                    </td>
                    <td>
                      <Link href={`/team/${staffUser.id}`}>Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">
              {query ? "No staff match this search." : "No staff accounts yet."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminResetPasswordForm } from "@/components/admin-reset-password-form";
import { AdminUpdateLoginEmailForm } from "@/components/admin-update-login-email-form";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BusinessForm } from "@/components/business-form";
import { assertCanAccessBusiness, assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  updateAdminBusinessBranchStatusAction,
  updateBusinessAction,
} from "../actions";

type BusinessDetailsPageProps = {
  params: Promise<{
    businessId: string;
  }>;
};

export default async function BusinessDetailsPage({
  params,
}: BusinessDetailsPageProps) {
  const { businessId } = await params;
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  assertCanAccessBusiness(user, businessId);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      branches: {
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      },
      users: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!business) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{business.name}</h1>
            <p>View and edit company setup details.</p>
          </div>
          <BackButton fallbackHref="/admin/businesses" />
        </div>

        <div className="grid">
          <Info label="Company ID" value={business.id} />
          <Info label="Company No." value={business.companyNo ?? "Not set"} />
          <Info label="Slug" value={business.slug} />
          <Info label="Status" value={business.status} />
          <Info label="Users" value={business.users.length.toString()} />
          <Info label="Branches" value={business.branches.length.toString()} />
        </div>

        <div className="panel">
          <h2>Company profile</h2>
          <BusinessForm
            action={updateBusinessAction}
            mode="edit"
            business={business}
            canEditStatus
          />
        </div>

        <div className="panel">
          <div className="section-header">
            <div>
              <h2>Branches</h2>
              <p>Only platform administrators can provision or deactivate branches.</p>
            </div>
            <Link
              className="button-link"
              href={`/admin/businesses/${business.id}/branches/new`}
            >
              New branch
            </Link>
          </div>
          {business.branches.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Provisioning</th>
                </tr>
              </thead>
              <tbody>
                {business.branches.map((branch, index) => {
                  const nextStatus = branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

                  return (
                    <tr key={branch.id}>
                      <td className="table-number">{index + 1}</td>
                      <td>{branch.name}</td>
                      <td>{branch.phone || "No phone"}</td>
                      <td>{branch.address || "No address"}</td>
                      <td>
                        <span className={`status ${branch.status.toLowerCase()}`}>
                          {branch.status.toLowerCase()}
                        </span>
                      </td>
                      <td>
                        <form action={updateAdminBusinessBranchStatusAction}>
                          <input type="hidden" name="businessId" value={business.id} />
                          <input type="hidden" name="branchId" value={branch.id} />
                          <input type="hidden" name="status" value={nextStatus} />
                          <button
                            className={
                              nextStatus === "ACTIVE"
                                ? "secondary-light-button"
                                : "danger-button"
                            }
                            type="submit"
                          >
                            {nextStatus === "ACTIVE" ? "Activate" : "Deactivate"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No branches have been provisioned yet.</p>
          )}
        </div>

        <div className="panel">
          <h2>Users</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Login email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Reset password</th>
              </tr>
            </thead>
            <tbody>
              {business.users.map((businessUser) => (
                <tr key={businessUser.id}>
                  <td>{businessUser.name}</td>
                  <td>
                    <AdminUpdateLoginEmailForm
                      businessId={business.id}
                      userId={businessUser.id}
                      email={businessUser.email}
                    />
                  </td>
                  <td>{businessUser.role.toLowerCase().replace("_", " ")}</td>
                  <td>
                    <span className={`status ${businessUser.status}`}>
                      {businessUser.status}
                    </span>
                  </td>
                  <td>
                    <AdminResetPasswordForm
                      businessId={business.id}
                      userId={businessUser.id}
                      userEmail={businessUser.email}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{value}</strong>
    </div>
  );
}

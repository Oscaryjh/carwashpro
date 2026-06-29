import { AdminResetPasswordForm } from "@/components/admin-reset-password-form";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BusinessForm } from "@/components/business-form";
import { assertCanAccessBusiness, assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { updateBusinessAction } from "../actions";

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

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: {
      users: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

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
          <h2>Users</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Reset password</th>
              </tr>
            </thead>
            <tbody>
              {business.users.map((businessUser) => (
                <tr key={businessUser.id}>
                  <td>{businessUser.name}</td>
                  <td>{businessUser.email}</td>
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

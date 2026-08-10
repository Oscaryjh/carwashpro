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
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { getBusinessModuleAdminView } from "@/lib/modules/service";
import {
  changeBusinessModuleEntitlementAction,
  updateAdminBusinessBranchStatusAction,
  updateBusinessAction,
} from "../actions";

type BusinessDetailsPageProps = {
  params: Promise<{
    businessId: string;
  }>;
  searchParams: Promise<{ type?: string; message?: string }>;
};

export default async function BusinessDetailsPage({
  params,
  searchParams,
}: BusinessDetailsPageProps) {
  const { businessId } = await params;
  const query = await searchParams;
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
  const moduleView = await getBusinessModuleAdminView(business.id);
  const now = new Date();

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
          <Info
            label="Industry"
            value={getBusinessIndustryLabel(business.industryType)}
          />
          <Info label="Status" value={business.status} />
          <Info label="Users" value={business.users.length.toString()} />
          <Info label="Branches" value={business.branches.length.toString()} />
        </div>

        {query.message ? (
          <div className={query.type === "error" ? "error-banner" : "success-banner"} role="status">
            {query.message}
          </div>
        ) : null}

        <div className="panel">
          <div className="section-header">
            <div>
              <h2>Business modules</h2>
              <p>Commercial entitlement is business-scoped and separate from user permissions. Manual changes require a reason.</p>
            </div>
          </div>
          <div className="grid">
            {moduleView.modules.map(({ definition, entitlement }) => {
              const effective = definition.isCore || Boolean(
                entitlement &&
                entitlement.status === "ENABLED" &&
                entitlement.enabledFrom <= now &&
                (entitlement.enabledUntil === null || entitlement.enabledUntil > now),
              );
              return (
                <article className="panel" key={definition.key}>
                  <div className="section-header">
                    <div>
                      <h3>{definition.label}</h3>
                      <p>{definition.category} · {definition.dependencies.length ? `Requires ${definition.dependencies.join(", ")}` : "No module dependency"}</p>
                    </div>
                    <span className={`status ${effective ? "active" : "inactive"}`}>{effective ? "enabled" : "not enabled"}</span>
                  </div>
                  {definition.isCore ? (
                    <p>CORE is SYSTEM_REQUIRED and cannot be disabled.</p>
                  ) : (
                    <form action={changeBusinessModuleEntitlementAction} className="form-grid">
                      <input name="businessId" type="hidden" value={business.id} />
                      <input name="moduleKey" type="hidden" value={definition.key} />
                      <input name="expectedRevision" type="hidden" value={entitlement?.revision ?? ""} />
                      <label>Status<select name="status" defaultValue={entitlement?.status ?? "DISABLED"}><option value="ENABLED">Enabled</option><option value="DISABLED">Disabled</option></select></label>
                      <label>Enabled from<input name="enabledFrom" type="datetime-local" defaultValue={toLocalInput(entitlement?.enabledFrom ?? now)} required /></label>
                      <label>Enabled until<input name="enabledUntil" type="datetime-local" defaultValue={entitlement?.enabledUntil ? toLocalInput(entitlement.enabledUntil) : ""} /></label>
                      <label>Plan reference (optional)<input name="planCode" defaultValue={entitlement?.planCode ?? ""} maxLength={80} /></label>
                      <label className="full-width">Reason<input name="reason" minLength={3} maxLength={500} required placeholder="Why this entitlement changes" /></label>
                      <button type="submit">Save module entitlement</button>
                    </form>
                  )}
                  {entitlement ? <small>Source {entitlement.source} · revision {entitlement.revision}</small> : <small>No entitlement record.</small>}
                </article>
              );
            })}
          </div>
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

function toLocalInput(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

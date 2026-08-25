import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminResetPasswordForm } from "@/components/admin-reset-password-form";
import { AdminUpdateLoginEmailForm } from "@/components/admin-update-login-email-form";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BusinessForm } from "@/components/business-form";
import { assertCanAccessBusiness, assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { getBusinessModuleAdminView } from "@/lib/modules/service";
import { prisma } from "@/lib/prisma";
import {
  changeBusinessModuleEntitlementAction,
  updateAdminBusinessBranchStatusAction,
  updateBusinessAction,
} from "../actions";
import styles from "../../admin-directory.module.css";

type BusinessDetailsPageProps = {
  params: Promise<{ businessId: string }>;
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
      branches: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
      users: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!business) notFound();

  const moduleView = await getBusinessModuleAdminView(business.id);
  const now = new Date();
  const enabledModuleCount = moduleView.modules.filter(
    ({ definition, entitlement }) =>
      definition.isCore ||
      Boolean(
        entitlement &&
        entitlement.status === "ENABLED" &&
        entitlement.enabledFrom <= now &&
        (entitlement.enabledUntil === null || entitlement.enabledUntil > now),
      ),
  ).length;

  return (
    <AppShell user={user}>
      <main className={styles.page}>
        <section className={styles.detailHero}>
          <div>
            <span className={styles.eyebrow}>Business workspace</span>
            <h1>{business.name}</h1>
            <p>
              Manage the company profile, access modules, branches and users in
              one place.
            </p>
            <div className={styles.detailMeta}>
              <span>{getBusinessIndustryLabel(business.industryType)}</span>
              <span>{business.slug}</span>
              <span>
                {business.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <BackButton fallbackHref="/admin/businesses" />
        </section>

        <section className={styles.metrics} aria-label="Business summary">
          <Metric
            label="Branches"
            value={business.branches.length.toString()}
          />
          <Metric label="Users" value={business.users.length.toString()} />
          <Metric
            label="Enabled modules"
            value={enabledModuleCount.toString()}
          />
          <Metric label="Company No." value={business.companyNo ?? "Not set"} />
        </section>

        <section className={styles.detailGrid} aria-label="Company identifiers">
          <Info label="Company ID" value={business.id} />
          <Info label="Company No." value={business.companyNo ?? "Not set"} />
          <Info label="Slug" value={business.slug} />
          <Info
            label="Industry"
            value={getBusinessIndustryLabel(business.industryType)}
          />
        </section>

        {query.message ? (
          <div
            className={`${styles.message} ${query.type === "error" ? styles.messageError : styles.messageSuccess}`}
            role="status"
          >
            {query.message}
          </div>
        ) : null}

        <section className={styles.sectionStack}>
          <details className={styles.disclosure}>
            <summary className={styles.disclosureTitle}>
              <span>
                <strong>Modules & access</strong>
                <small>Choose which product areas this business can use.</small>
              </span>
              <span className={styles.countBadge}>
                {moduleView.modules.length} modules
              </span>
            </summary>
            <form
              action={changeBusinessModuleEntitlementAction}
              className={styles.disclosureContent}
            >
              <input name="businessId" type="hidden" value={business.id} />
              <div className={styles.toolbar}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    Change note (optional)
                  </span>
                  <input
                    name="reason"
                    minLength={3}
                    maxLength={500}
                    placeholder="Add a note for this update"
                  />
                </label>
                <button className={styles.primaryAction} type="submit">
                  Save module access
                </button>
              </div>
              <div className={styles.moduleGrid}>
                {moduleView.modules.map(({ definition, entitlement }) => {
                  const effective =
                    definition.isCore ||
                    Boolean(
                      entitlement &&
                      entitlement.status === "ENABLED" &&
                      entitlement.enabledFrom <= now &&
                      (entitlement.enabledUntil === null ||
                        entitlement.enabledUntil > now),
                    );

                  return (
                    <article className={styles.moduleCard} key={definition.key}>
                      <div className={styles.panelHeader}>
                        <div>
                          <h3>{definition.label}</h3>
                          <p>
                            {definition.dependencies.length
                              ? `Requires ${definition.dependencies.join(", ")}`
                              : definition.category}
                          </p>
                        </div>
                        <span
                          className={
                            effective
                              ? styles.statusBadge
                              : styles.statusBadgeInactive
                          }
                        >
                          {effective ? "Enabled" : "Not enabled"}
                        </span>
                      </div>
                      {definition.isCore ? (
                        <p>Core access is required and remains enabled.</p>
                      ) : (
                        <div className={styles.moduleFields}>
                          <input
                            name="moduleKey"
                            type="hidden"
                            value={definition.key}
                          />
                          <input
                            name={`expectedRevision:${definition.key}`}
                            type="hidden"
                            value={entitlement?.revision ?? ""}
                          />
                          <label>
                            Status
                            <select
                              name={`status:${definition.key}`}
                              defaultValue={entitlement?.status ?? "DISABLED"}
                            >
                              <option value="ENABLED">Enabled</option>
                              <option value="DISABLED">Disabled</option>
                            </select>
                          </label>
                          <label>
                            Enabled from
                            <input
                              name={`enabledFrom:${definition.key}`}
                              type="datetime-local"
                              defaultValue={toLocalInput(
                                entitlement?.enabledFrom ?? now,
                              )}
                              required
                            />
                          </label>
                          <label>
                            Enabled until
                            <input
                              name={`enabledUntil:${definition.key}`}
                              type="datetime-local"
                              defaultValue={
                                entitlement?.enabledUntil
                                  ? toLocalInput(entitlement.enabledUntil)
                                  : ""
                              }
                            />
                          </label>
                          <label>
                            Plan reference
                            <input
                              name={`planCode:${definition.key}`}
                              defaultValue={entitlement?.planCode ?? ""}
                              maxLength={80}
                              placeholder="Optional"
                            />
                          </label>
                        </div>
                      )}
                      {entitlement ? (
                        <small>
                          Source: {entitlement.source} · Revision{" "}
                          {entitlement.revision}
                        </small>
                      ) : (
                        <small>No saved access record.</small>
                      )}
                    </article>
                  );
                })}
              </div>
            </form>
          </details>

          <details className={styles.disclosure}>
            <summary className={styles.disclosureTitle}>
              <span>
                <strong>Company profile</strong>
                <small>
                  Update the legal name, company number, industry and status.
                </small>
              </span>
            </summary>
            <div className={styles.disclosureContent}>
              <BusinessForm
                action={updateBusinessAction}
                mode="edit"
                business={business}
                canEditStatus
              />
            </div>
          </details>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Branches</h2>
              <p>Locations that operate under this business.</p>
            </div>
            <Link
              className={styles.primaryAction}
              href={`/admin/businesses/${business.id}/branches/new`}
            >
              + Add branch
            </Link>
          </div>
          {business.branches.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {business.branches.map((branch, index) => {
                    const nextStatus =
                      branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
                    return (
                      <tr key={branch.id}>
                        <td>{index + 1}</td>
                        <td>
                          <strong>{branch.name}</strong>
                        </td>
                        <td>{branch.phone || "No phone"}</td>
                        <td>{branch.address || "No address"}</td>
                        <td>
                          <span
                            className={
                              branch.status === "ACTIVE"
                                ? styles.statusBadge
                                : styles.statusBadgeInactive
                            }
                          >
                            {branch.status === "ACTIVE" ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <form action={updateAdminBusinessBranchStatusAction}>
                            <input
                              type="hidden"
                              name="businessId"
                              value={business.id}
                            />
                            <input
                              type="hidden"
                              name="branchId"
                              value={branch.id}
                            />
                            <input
                              type="hidden"
                              name="status"
                              value={nextStatus}
                            />
                            <button
                              className={
                                nextStatus === "ACTIVE"
                                  ? "secondary-light-button"
                                  : "danger-button"
                              }
                              type="submit"
                            >
                              {nextStatus === "ACTIVE"
                                ? "Activate"
                                : "Deactivate"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.emptyTable}>
              No branches yet. Add the first location for this business.
            </p>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Users</h2>
              <p>People who can sign in to this business workspace.</p>
            </div>
            <span className={styles.countBadge}>
              {business.users.length} users
            </span>
          </div>
          {business.users.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Login email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Password</th>
                  </tr>
                </thead>
                <tbody>
                  {business.users.map((businessUser) => (
                    <tr key={businessUser.id}>
                      <td>
                        <strong>{businessUser.name}</strong>
                      </td>
                      <td>
                        <AdminUpdateLoginEmailForm
                          businessId={business.id}
                          userId={businessUser.id}
                          email={businessUser.email}
                        />
                      </td>
                      <td>
                        {businessUser.role.toLowerCase().replace("_", " ")}
                      </td>
                      <td>
                        <span
                          className={
                            businessUser.status === "active"
                              ? styles.statusBadge
                              : styles.statusBadgeInactive
                          }
                        >
                          {businessUser.status === "active"
                            ? "Active"
                            : "Inactive"}
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
          ) : (
            <p className={styles.emptyTable}>
              No users are assigned to this business.
            </p>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function toLocalInput(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

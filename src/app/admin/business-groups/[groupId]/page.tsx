import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BusinessGroupAccountEdit } from "@/components/business-group-account-edit";
import { BusinessGroupAccountFields } from "@/components/business-group-account-fields";
import { BusinessGroupActionForm } from "@/components/business-group-action-form";
import { BusinessGroupBusinessPicker } from "@/components/business-group-business-picker";
import { BusinessGroupExistingUserAccessFields } from "@/components/business-group-existing-user-access-fields";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { prisma } from "@/lib/prisma";
import {
  addBusinessToGroupAction,
  createBusinessGroupAccountAction,
  deactivateBusinessGroupAction,
  grantBusinessGroupUserAction,
  removeBusinessFromGroupAction,
  revokeBusinessGroupUserAction,
  updateBusinessGroupAccountAction,
} from "../actions";

type BusinessGroupDetailPageProps = { params: Promise<{ groupId: string }> };

export default async function BusinessGroupDetailPage({ params }: BusinessGroupDetailPageProps) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const { groupId } = await params;

  const group = await prisma.businessGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: { business: { select: { id: true, name: true, industryType: true, status: true } } },
        orderBy: { joinedAt: "desc" },
      },
      users: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              businessId: true,
              business: { select: { name: true } },
            },
          },
          businessAccesses: { include: { business: { select: { name: true } } } },
        },
        orderBy: { grantedAt: "desc" },
      },
      auditLogs: {
        include: { actor: { select: { name: true, email: true } }, business: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });
  if (!group) notFound();

  const [eligibleBusinesses, eligibleUsers] = await Promise.all([
    prisma.business.findMany({
      where: {
        status: "active",
        businessGroupMemberships: { none: { status: "ACTIVE" } },
      },
      select: { id: true, name: true, slug: true, companyNo: true, industryType: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        businessId: { not: null },
        status: "active",
        role: { in: ["BUSINESS_OWNER", "STAFF"] },
        businessGroupUsers: {
          none: { groupId, status: "ACTIVE" },
        },
      },
      select: { id: true, name: true, email: true, business: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const activeMembers = group.members.filter((member) => member.status === "ACTIVE");
  const removedMembers = group.members.filter((member) => member.status !== "ACTIVE");
  const activeGroupUsers = group.users.filter((grant) => grant.status === "ACTIVE");
  const groupLoginCount = activeGroupUsers.filter(
    (grant) => grant.user.businessId === null,
  ).length;

  return (
    <AppShell user={user}>
      <section className="content business-group-detail-page">
        <header className="business-group-detail-header">
          <div className="business-group-detail-heading">
            <BackButton fallbackHref="/admin/business-groups" />
            <div>
              <div className="business-group-detail-title">
                <h1>{group.name}</h1>
                <span className={`status ${group.status.toLowerCase()}`}>
                  {group.status.toLowerCase()}
                </span>
              </div>
              <p>{group.code}</p>
            </div>
          </div>
          {group.status === "ACTIVE" ? (
            <form action={deactivateBusinessGroupAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button className="business-group-deactivate-button" type="submit">
                Deactivate group
              </button>
            </form>
          ) : null}
        </header>

        <div className="business-group-summary-strip" aria-label="Group summary">
          <div>
            <strong>{activeMembers.length}</strong>
            <span>Active businesses</span>
          </div>
          <div>
            <strong>{activeGroupUsers.length}</strong>
            <span>Active group users</span>
          </div>
          <div>
            <strong>{groupLoginCount}</strong>
            <span>Dedicated logins</span>
          </div>
          <div>
            <strong>{removedMembers.length}</strong>
            <span>Removed memberships</span>
          </div>
        </div>

        <section className="panel business-group-section">
          <div className="section-header">
            <div>
              <p className="business-group-section-eyebrow">MEMBERSHIP</p>
              <h2>Businesses</h2>
              <p className="muted">
                Active businesses keep their own data and tenant boundary.
              </p>
            </div>
            <span className="business-group-section-count">{activeMembers.length} active</span>
          </div>
          {group.status === "ACTIVE" && eligibleBusinesses.length ? (
            <details className="business-group-inline-disclosure">
              <summary>
                <span>
                  <strong>Add a business</strong>
                  <small>Search active businesses that are not already in a group.</small>
                </span>
                <span aria-hidden="true">+</span>
              </summary>
              <BusinessGroupBusinessPicker
                action={addBusinessToGroupAction}
                businesses={eligibleBusinesses.map((business) => ({
                  id: business.id,
                  name: business.name,
                  slug: business.slug,
                  companyNo: business.companyNo,
                  industryLabel: getBusinessIndustryLabel(business.industryType),
                }))}
                groupId={group.id}
              />
            </details>
          ) : null}
          {activeMembers.length ? (
            <div className="business-group-table-wrap">
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Industry</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {activeMembers.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <Link href={`/admin/businesses/${member.business.id}`}>
                          {member.business.name}
                        </Link>
                      </td>
                      <td>{getBusinessIndustryLabel(member.business.industryType)}</td>
                      <td>{member.joinedAt.toLocaleString("en-MY")}</td>
                      <td>
                        <span className="status active">active</span>
                      </td>
                      <td>
                        {group.status === "ACTIVE" ? (
                          <BusinessGroupActionForm
                            action={removeBusinessFromGroupAction}
                            confirmMessage={`Remove "${member.business.name}" from this group?\n\nThe business and all of its operating data will remain unchanged.`}
                          >
                            <input type="hidden" name="groupId" value={group.id} />
                            <input type="hidden" name="memberId" value={member.id} />
                            <button className="danger-button" type="submit">Remove</button>
                          </BusinessGroupActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty-state">No businesses in this group.</p>}

          {removedMembers.length ? (
            <details className="business-group-history-disclosure">
              <summary>
                Membership history
                <span>{removedMembers.length}</span>
              </summary>
              <div className="business-group-table-wrap">
                <table className="table compact-table">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Industry</th>
                      <th>Joined</th>
                      <th>Removed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {removedMembers.map((member) => (
                      <tr key={member.id}>
                        <td>{member.business.name}</td>
                        <td>{getBusinessIndustryLabel(member.business.industryType)}</td>
                        <td>{member.joinedAt.toLocaleString("en-MY")}</td>
                        <td>{member.removedAt?.toLocaleString("en-MY") ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>

        {group.status === "ACTIVE" ? (
          <div className="business-group-access-grid">
            <details className="panel business-group-config-panel">
              <summary>
                <span>
                  <span className="business-group-section-eyebrow">NEW ACCOUNT</span>
                  <strong>Create group login</strong>
                  <small>A dedicated login that is not tied to one business.</small>
                </span>
                <span aria-hidden="true">+</span>
              </summary>
              <BusinessGroupActionForm
                action={createBusinessGroupAccountAction}
                className="business-group-account-form"
              >
                <BusinessGroupAccountFields
                  groupId={group.id}
                  businesses={activeMembers.map((member) => ({
                    id: member.businessId,
                    name: member.business.name,
                  }))}
                />
              </BusinessGroupActionForm>
            </details>

            <details className="panel business-group-config-panel">
              <summary>
                <span>
                  <span className="business-group-section-eyebrow">EXISTING USER</span>
                  <strong>Grant group access</strong>
                  <small>Add group access without changing the existing business role.</small>
                </span>
                <span aria-hidden="true">+</span>
              </summary>
              {eligibleUsers.length ? (
                <BusinessGroupActionForm
                  action={grantBusinessGroupUserAction}
                  className="business-group-account-form"
                >
                  <BusinessGroupExistingUserAccessFields
                    groupId={group.id}
                    users={eligibleUsers.map((target) => ({
                      id: target.id,
                      name: target.name,
                      email: target.email,
                      businessName: target.business?.name ?? null,
                    }))}
                    businesses={activeMembers.map((member) => ({
                      id: member.businessId,
                      name: member.business.name,
                    }))}
                  />
                </BusinessGroupActionForm>
              ) : (
                <p className="empty-state">No eligible business users are available.</p>
              )}
            </details>
          </div>
        ) : null}

        <section className="panel business-group-section">
          <div className="section-header">
            <div>
              <p className="business-group-section-eyebrow">ACCESS</p>
              <h2>Group users</h2>
              <p className="muted">Dedicated logins and existing users with group access.</p>
            </div>
            <span className="business-group-section-count">{activeGroupUsers.length} active</span>
          </div>
          {group.users.length ? (
            <div className="business-group-table-wrap">
              <table className="table compact-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Account type</th>
                  <th>Role</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Granted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.users.map((grant) => {
                  const isGroupLogin = grant.user.businessId === null;

                  return (
                    <tr key={grant.id}>
                      <td>
                        <strong>{grant.user.name}</strong>
                        <div className="muted">{grant.user.email ?? "No login email"}</div>
                      </td>
                      <td>{isGroupLogin ? "Group login" : "Business user"}</td>
                      <td>{grant.role}</td>
                      <td>
                        {grant.accessScope === "ALL_GROUP_BUSINESSES"
                          ? "All group businesses"
                          : grant.businessAccesses.map((access) => access.business.name).join(", ")}
                      </td>
                      <td>
                        <span className={`status ${grant.status.toLowerCase()}`}>
                          {grant.status.toLowerCase()}
                        </span>
                      </td>
                      <td>{grant.grantedAt.toLocaleString("en-MY")}</td>
                      <td>
                        {group.status === "ACTIVE" && grant.status === "ACTIVE" ? (
                          <div className="business-group-user-actions">
                            {isGroupLogin && grant.user.email ? (
                              <BusinessGroupAccountEdit
                                action={updateBusinessGroupAccountAction}
                                email={grant.user.email}
                                groupId={group.id}
                                groupUserId={grant.id}
                                name={grant.user.name}
                              />
                            ) : null}
                            <BusinessGroupActionForm
                              action={revokeBusinessGroupUserAction}
                              confirmMessage={`Revoke ${grant.role.replace("_", " ").toLowerCase()} access for "${grant.user.name}"?`}
                            >
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="groupUserId" value={grant.id} />
                              <button className="danger-button" type="submit">Revoke</button>
                            </BusinessGroupActionForm>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          ) : <p className="empty-state">No group users yet.</p>}
        </section>

        <details className="panel business-group-activity-panel">
          <summary>
            <span>
              <span className="business-group-section-eyebrow">AUDIT</span>
              <strong>Group activity</strong>
              <small>Most recent 30 group management events.</small>
            </span>
            <span>{group.auditLogs.length}</span>
          </summary>
          {group.auditLogs.length ? (
            <div className="business-group-table-wrap">
              <table className="table compact-table">
                <thead>
                  <tr><th>When</th><th>Action</th><th>Summary</th><th>Actor</th></tr>
                </thead>
                <tbody>
                  {group.auditLogs.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.createdAt.toLocaleString("en-MY")}</td>
                      <td>{entry.action}</td>
                      <td>{entry.summary}</td>
                      <td>{entry.actor?.name ?? "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty-state">No group activity yet.</p>}
        </details>
      </section>
    </AppShell>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  addBusinessToGroupAction,
  deactivateBusinessGroupAction,
  grantBusinessGroupUserAction,
  removeBusinessFromGroupAction,
  revokeBusinessGroupUserAction,
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
          user: { select: { id: true, name: true, email: true, business: { select: { name: true } } } },
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
      select: { id: true, name: true, industryType: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { status: "active", role: { in: ["BUSINESS_OWNER", "STAFF"] } },
      select: { id: true, name: true, email: true, business: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const activeMembers = group.members.filter((member) => member.status === "ACTIVE");

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <BackButton fallbackHref="/admin/business-groups" />
            <h1>{group.name}</h1>
            <p>{group.code} - {group.status.toLowerCase()} group</p>
          </div>
          {group.status === "ACTIVE" ? (
            <form action={deactivateBusinessGroupAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button className="danger-button" type="submit">Deactivate group</button>
            </form>
          ) : null}
        </div>

        <section className="panel">
          <div className="section-header">
            <div>
              <h2>Businesses</h2>
              <p className="muted">Each business retains its own data and tenant boundary.</p>
            </div>
          </div>
          {group.status === "ACTIVE" && eligibleBusinesses.length ? (
            <form action={addBusinessToGroupAction} className="inline-form">
              <input type="hidden" name="groupId" value={group.id} />
              <select name="businessId" required defaultValue="">
                <option value="" disabled>Add an active business</option>
                {eligibleBusinesses.map((business) => <option key={business.id} value={business.id}>{business.name} - {business.industryType}</option>)}
              </select>
              <button type="submit">Add business</button>
            </form>
          ) : null}
          {group.members.length ? (
            <table className="table compact-table">
              <thead><tr><th>Business</th><th>Industry</th><th>Membership</th><th>Joined</th><th>Removed</th><th /></tr></thead>
              <tbody>
                {group.members.map((member) => (
                  <tr key={member.id}>
                    <td><Link href={`/admin/businesses/${member.business.id}`}>{member.business.name}</Link></td>
                    <td>{member.business.industryType}</td>
                    <td><span className={`status ${member.status.toLowerCase()}`}>{member.status.toLowerCase()}</span></td>
                    <td>{member.joinedAt.toLocaleString()}</td>
                    <td>{member.removedAt?.toLocaleString() ?? "-"}</td>
                    <td>{group.status === "ACTIVE" && member.status === "ACTIVE" ? <form action={removeBusinessFromGroupAction}><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="memberId" value={member.id} /><button className="danger-button" type="submit">Remove</button></form> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty-state">No businesses in this group.</p>}
        </section>

        <section className="panel">
          <div className="section-header"><div><h2>Group access</h2><p className="muted">Owners receive all-group access. Managers must be restricted to selected group businesses.</p></div></div>
          {group.status === "ACTIVE" && eligibleUsers.length ? (
            <form action={grantBusinessGroupUserAction} className="field-grid">
              <input type="hidden" name="groupId" value={group.id} />
              <label>User<select name="userId" required defaultValue=""><option value="" disabled>Select an existing business user</option>{eligibleUsers.map((target) => <option key={target.id} value={target.id}>{target.name} - {target.email ?? "no login email"} - {target.business?.name ?? "no business"}</option>)}</select></label>
              <label>Group role<select name="role" defaultValue="GROUP_OWNER"><option value="GROUP_OWNER">Group owner</option><option value="GROUP_MANAGER">Group manager</option></select></label>
              <label className="field-grid-span-full">Manager business scope<select name="businessIds" multiple size={Math.min(6, Math.max(3, activeMembers.length))}>{activeMembers.map((member) => <option key={member.id} value={member.businessId}>{member.business.name}</option>)}</select><span className="muted">Required for Group manager. Group owner always receives all active group businesses.</span></label>
              <div className="form-actions field-grid-span-full"><button type="submit">Grant group access</button></div>
            </form>
          ) : null}
          {group.users.length ? (
            <table className="table compact-table"><thead><tr><th>User</th><th>Role</th><th>Scope</th><th>Status</th><th>Granted</th><th /></tr></thead><tbody>{group.users.map((grant) => <tr key={grant.id}><td><strong>{grant.user.name}</strong><div className="muted">{grant.user.email ?? "No login email"}</div></td><td>{grant.role}</td><td>{grant.accessScope === "ALL_GROUP_BUSINESSES" ? "All group businesses" : grant.businessAccesses.map((access) => access.business.name).join(", ")}</td><td><span className={`status ${grant.status.toLowerCase()}`}>{grant.status.toLowerCase()}</span></td><td>{grant.grantedAt.toLocaleString()}</td><td>{group.status === "ACTIVE" && grant.status === "ACTIVE" ? <form action={revokeBusinessGroupUserAction}><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="groupUserId" value={grant.id} /><button className="danger-button" type="submit">Revoke</button></form> : null}</td></tr>)}</tbody></table>
          ) : <p className="empty-state">No group users yet.</p>}
        </section>

        <section className="panel">
          <div className="section-header"><div><h2>Group activity</h2><p className="muted">Most recent 30 group management events.</p></div></div>
          {group.auditLogs.length ? <table className="table compact-table"><thead><tr><th>When</th><th>Action</th><th>Summary</th><th>Actor</th></tr></thead><tbody>{group.auditLogs.map((entry) => <tr key={entry.id}><td>{entry.createdAt.toLocaleString()}</td><td>{entry.action}</td><td>{entry.summary}</td><td>{entry.actor?.name ?? "System"}</td></tr>)}</tbody></table> : <p className="empty-state">No group activity yet.</p>}
        </section>
      </section>
    </AppShell>
  );
}

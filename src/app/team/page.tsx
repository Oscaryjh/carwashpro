import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import {
  defaultStaffPermissions,
  staffPermissions,
} from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { createStaffAction, updateStaffAction } from "./actions";

type TeamPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const params = await searchParams;
  const message = params.message;
  const messageType = params.type === "error" ? "error" : "success";
  const staff = await prisma.user.findMany({
    where: {
      businessId,
      role: "STAFF",
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Team</h1>
            <p>Manage staff login access and module permissions for this business.</p>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="panel">
          <div className="section-header">
            <h2>Create staff</h2>
          </div>
          <form className="form" action={createStaffAction}>
            <div className="field-grid">
              <label>
                <span>Name</span>
                <input name="name" required />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" required />
              </label>
              <label>
                <span>WhatsApp Number</span>
                <input
                  inputMode="numeric"
                  name="whatsappPhone"
                  placeholder="60123456789"
                />
              </label>
              <label>
                <span>Password</span>
                <input name="password" type="password" minLength={8} required />
              </label>
            </div>
            <PermissionChecklist defaultPermissions={defaultStaffPermissions} />
            <div className="form-actions">
              <button type="submit">Create staff</button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Staff accounts</h2>
          </div>
          {staff.length ? (
            <div className="team-list">
              {staff.map((staffUser, index) => (
                <form
                  action={updateStaffAction}
                  className="team-member-card"
                  key={staffUser.id}
                >
                  <input type="hidden" name="userId" value={staffUser.id} />
                  <div className="team-member-header">
                    <span className="table-number">{index + 1}</span>
                    <div>
                      <strong>{staffUser.name}</strong>
                      <div className="muted">{staffUser.email}</div>
                    </div>
                    <span className="status">{staffUser.status}</span>
                  </div>
                  <div className="field-grid">
                    <label>
                      <span>Name</span>
                      <input name="name" defaultValue={staffUser.name} required />
                    </label>
                    <label>
                      <span>Email</span>
                      <input
                        name="email"
                        type="email"
                        defaultValue={staffUser.email}
                        required
                      />
                    </label>
                    <label>
                      <span>WhatsApp Number</span>
                      <input
                        defaultValue={staffUser.whatsappPhone ?? ""}
                        inputMode="numeric"
                        name="whatsappPhone"
                        placeholder="60123456789"
                      />
                    </label>
                    <label>
                      <span>Status</span>
                      <select name="status" defaultValue={staffUser.status}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    <label>
                      <span>New password optional</span>
                      <input
                        name="password"
                        type="password"
                        minLength={8}
                        placeholder="Leave blank to keep current"
                      />
                    </label>
                  </div>
                  <PermissionChecklist defaultPermissions={staffUser.permissions} />
                  <div className="form-actions">
                    <button type="submit">Save</button>
                  </div>
                </form>
              ))}
            </div>
          ) : (
            <p className="empty-state">No staff accounts yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function PermissionChecklist({
  defaultPermissions,
}: {
  defaultPermissions: string[];
}) {
  const selected = new Set(defaultPermissions);

  return (
    <div className="permission-grid">
      {staffPermissions.map((permission) => (
        <label className="permission-card" key={permission.key}>
          <input
            defaultChecked={selected.has(permission.key)}
            name="permissions"
            type="checkbox"
            value={permission.key}
          />
          <span>
            <strong>{permission.label}</strong>
            <small>{permission.description}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

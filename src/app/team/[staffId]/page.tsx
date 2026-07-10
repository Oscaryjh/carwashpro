import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { StaffForm } from "@/components/staff-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  assertStaffPermission,
  hasStaffPermission,
} from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { deleteStaffAction, updateStaffAction } from "../actions";

type StaffDetailsPageProps = {
  params: Promise<{
    staffId: string;
  }>;
};

export default async function StaffDetailsPage({ params }: StaffDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

  const { staffId } = await params;
  const [staff, branches] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: staffId,
        businessId,
        role: "STAFF",
      },
    }),
    getActiveBranches(businessId),
  ]);

  if (!staff) {
    notFound();
  }

  const canDeleteStaff =
    hasStaffPermission(user, "DELETE_STAFF") && staff.id !== user.userId;

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{staff.name}</h1>
            <p>Edit staff account, branch assignment, and access permissions.</p>
          </div>
          <BackButton fallbackHref="/team" />
        </div>

        {!branches.length ? (
          <div className="warning">
            Create an active branch before editing staff branch assignment.
          </div>
        ) : null}

        <div className="panel team-create-card">
          <div className="section-header">
            <h2>Staff details</h2>
            <span className="status">{staff.status}</span>
          </div>
          <StaffForm
            action={updateStaffAction}
            branches={branches}
            staff={staff}
            submitLabel="Save staff"
          />
        </div>

        {canDeleteStaff ? (
          <div className="panel danger-panel">
            <div>
              <h2>Delete staff</h2>
              <p>
                Delete this staff only if it has no shift, payment, or message history.
                Staff with history should be set to inactive instead.
              </p>
            </div>
            <form action={deleteStaffAction} className="danger-zone-form">
              <input type="hidden" name="userId" value={staff.id} />
              <button className="danger-button" type="submit">
                Delete staff
              </button>
            </form>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

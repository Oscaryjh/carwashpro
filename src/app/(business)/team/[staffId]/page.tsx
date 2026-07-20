import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { StaffForm } from "@/components/staff-form";
import { StaffAvailabilityForm } from "@/components/staff-availability-form";
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
  const [staff, branches, availability, breaks, timeOff] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: staffId,
        businessId,
        role: "STAFF",
      },
    }),
    getActiveBranches(businessId),
    prisma.staffAvailability.findMany({
      where: { businessId, userId: staffId },
      orderBy: { dayOfWeek: "asc" },
    }),
    prisma.staffBreak.findMany({
      where: { businessId, userId: staffId },
      orderBy: { dayOfWeek: "asc" },
    }),
    prisma.staffTimeOff.findMany({
      where: { businessId, userId: staffId, endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  if (!staff) {
    notFound();
  }

  const assignedBranchIds = staff.employeeAccountId
    ? (
        await prisma.employeeBranchAssignment.findMany({
          where: {
            businessId,
            membership: { employeeAccountId: staff.employeeAccountId },
          },
          select: { branchId: true },
        })
      ).map((assignment) => assignment.branchId)
    : staff.branchId
      ? [staff.branchId]
      : [];

  const canDeleteStaff =
    hasStaffPermission(user, "DELETE_STAFF") && staff.id !== user.userId;

  return (
    <>
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
            assignedBranchIds={assignedBranchIds}
            submitLabel="Save staff"
          />
        </div>

        <StaffAvailabilityForm
          staffId={staff.id}
          availability={availability}
          breaks={breaks}
          timeOff={timeOff}
        />

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
    </>
  );
}

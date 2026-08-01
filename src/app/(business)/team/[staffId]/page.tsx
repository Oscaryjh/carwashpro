import { notFound, redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  buildPeopleStaffScopeWhere,
  hasWholeBusinessPeopleScope,
} from "@/lib/team/people-scope";

type StaffDetailsPageProps = {
  params: Promise<{
    staffId: string;
  }>;
};

export default async function StaffDetailsPage({
  params,
}: StaffDetailsPageProps) {
  const context = await requireBusinessUser("VIEW_TEAM_DIRECTORY");
  if (context.access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(context.user, "TEAM");
  }
  const scope = await resolveAttendanceScope(context.access);

  const { staffId } = await params;
  const staff = await prisma.user.findFirst({
    where: {
      ...buildPeopleStaffScopeWhere({
        allowedBranchIds: scope.allowedBranchIds,
        businessId: context.businessId,
        now: new Date(),
        wholeBusinessScope: hasWholeBusinessPeopleScope(context.access),
      }),
      id: staffId,
      role: "STAFF",
    },
    select: { id: true },
  });

  if (!staff) {
    notFound();
  }

  redirect(`/team/people/${staff.id}`);
}

import { timingSafeEqual } from "node:crypto";
import { listAttendanceOvertimeCandidates } from "@/lib/attendance/overtime-service";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import { prisma } from "@/lib/prisma";
import {
  getStaffOvertimeQueue,
  getStaffOvertimeSummary,
  resolveStaffOvertimeAccess,
} from "@/lib/staff-pwa/overtime-approvals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const expectedToken = process.env.OT_DIAGNOSTIC_TOKEN;
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expectedToken || !constantTimeEqual(expectedToken, suppliedToken)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const phone = normalizeAttendancePhone(new URL(request.url).searchParams.get("phone") ?? "");
  if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

  const account = await prisma.employeeAccount.findUnique({
    where: { phoneNormalized: phone },
    select: {
      id: true,
      status: true,
      memberships: {
        select: {
          id: true,
          businessId: true,
          employeeAccountId: true,
          employeeCode: true,
          fullName: true,
          status: true,
          business: { select: { id: true, name: true } },
          branchAssignments: {
            select: {
              branchId: true,
              isPrimary: true,
              status: true,
              branch: { select: { id: true, name: true } },
            },
          },
          staffUser: {
            select: {
              id: true,
              branchId: true,
              role: true,
              permissions: true,
              status: true,
              staffRoleProfile: {
                select: { id: true, name: true, permissions: true, active: true },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      sessions: {
        select: {
          id: true,
          membershipId: true,
          businessId: true,
          primaryBranchId: true,
          attendanceBranchId: true,
          employeeDeviceId: true,
          createdAt: true,
          lastActiveAt: true,
          expiresAt: true,
          revokedAt: true,
          revokeReason: true,
          business: { select: { id: true, name: true } },
          primaryBranch: { select: { id: true, name: true } },
          attendanceBranch: { select: { id: true, name: true } },
          employeeDevice: {
            select: {
              id: true,
              displayName: true,
              platform: true,
              browser: true,
              status: true,
              lastActiveAt: true,
            },
          },
        },
        orderBy: { lastActiveAt: "desc" },
        take: 20,
      },
    },
  });

  if (!account) return Response.json({ error: "Account not found" }, { status: 404 });

  const now = new Date();
  const activeSessions = account.sessions.filter((session) => !session.revokedAt && session.expiresAt > now);
  const sessionDiagnostics = await Promise.all(activeSessions.map(async (session) => {
    const auth: EmployeeAuthContext = {
      sessionId: session.id,
      employeeAccountId: account.id,
      membershipId: session.membershipId,
      businessId: session.businessId,
      primaryBranchId: session.primaryBranchId,
      attendanceBranchId: session.attendanceBranchId ?? undefined,
      deviceId: session.employeeDeviceId ?? "diagnostic-no-device",
    };
    const access = await resolveStaffOvertimeAccess(auth);
    const rawCandidates = access
      ? await listAttendanceOvertimeCandidates({
          businessId: access.businessId,
          allowedBranchIds: access.allowedBranchIds,
          periodStart: new Date("2026-08-01T00:00:00.000Z"),
          periodEndExclusive: new Date("2026-09-01T00:00:00.000Z"),
        })
      : [];
    const queue = await getStaffOvertimeQueue({ auth, month: "2026-08" });
    const summary = await getStaffOvertimeSummary(auth);
    const candidateMembershipIds = [...new Set(rawCandidates.map((candidate) => candidate.membershipId))];
    const candidateMemberships = candidateMembershipIds.length
      ? await prisma.employeeBusinessMembership.findMany({
          where: { id: { in: candidateMembershipIds } },
          select: {
            id: true,
            employeeAccountId: true,
            fullName: true,
            staffUser: { select: { id: true } },
          },
        })
      : [];
    const membershipById = new Map(candidateMemberships.map((membership) => [membership.id, membership]));

    return {
      sessionId: session.id,
      actorAccountId: account.id,
      actorMembershipId: session.membershipId,
      businessId: session.businessId,
      businessName: session.business.name,
      primaryBranchId: session.primaryBranchId,
      primaryBranchName: session.primaryBranch.name,
      attendanceBranchId: session.attendanceBranchId,
      attendanceBranchName: session.attendanceBranch?.name ?? null,
      deviceId: session.employeeDeviceId,
      device: session.employeeDevice,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      expiresAt: session.expiresAt,
      access: access ? {
        actorUserId: access.actor.userId,
        actorMembershipId: access.actorMembershipId,
        allowedBranchIds: access.allowedBranchIds,
        wholeBusinessScope: access.wholeBusinessScope,
      } : null,
      rawCandidates: rawCandidates.map((candidate) => {
        const membership = membershipById.get(candidate.membershipId);
        return {
          finalResultId: candidate.finalResultId,
          membershipId: candidate.membershipId,
          employeeAccountId: membership?.employeeAccountId ?? null,
          staffUserId: membership?.staffUser?.id ?? candidate.employeeUserId,
          employeeName: candidate.employeeName,
          branchId: candidate.branchId,
          branchName: candidate.branchName,
          workDate: candidate.workDate,
          effectiveStatus: candidate.effectiveStatus,
          reviewId: candidate.review?.id ?? null,
          reviewStatus: candidate.review?.status ?? null,
          reviewRevision: candidate.review?.revision ?? 0,
          stale: candidate.stale,
        };
      }),
      serverQueue: queue ? {
        pending: queue.pending,
        itemMembershipIds: queue.items.map((item) => item.membershipId),
        items: queue.items.map((item) => ({
          finalResultId: item.finalResultId,
          membershipId: item.membershipId,
          employeeName: item.employeeName,
          workDate: item.workDate,
          effectiveStatus: item.effectiveStatus,
        })),
      } : null,
      summary,
    };
  }));

  const royalSalonMembership = account.memberships.find(
    (membership) => membership.business.name === "Royal Salon",
  );
  const identityCollisionAudit = royalSalonMembership
    ? await loadIdentityCollisionAudit({
        accountId: account.id,
        businessId: royalSalonMembership.businessId,
        currentMembershipId: royalSalonMembership.id,
        displayName: royalSalonMembership.fullName,
      })
    : null;

  return Response.json({
    capturedAt: now,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    accountId: account.id,
    accountStatus: account.status,
    memberships: account.memberships,
    sessions: account.sessions.map((session) => ({
      ...session,
      active: !session.revokedAt && session.expiresAt > now,
    })),
    sessionDiagnostics,
    identityCollisionAudit,
  }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

async function loadIdentityCollisionAudit(input: {
  accountId: string;
  businessId: string;
  currentMembershipId: string;
  displayName: string;
}) {
  const memberships = await prisma.employeeBusinessMembership.findMany({
    where: {
      businessId: input.businessId,
      fullName: input.displayName,
    },
    select: {
      id: true,
      employeeAccountId: true,
      employeeCode: true,
      fullName: true,
      status: true,
      joinedAt: true,
      terminatedAt: true,
      employeeAccount: { select: { id: true, status: true, name: true } },
      staffUser: {
        select: {
          id: true,
          status: true,
          loginEnabled: true,
          role: true,
          permissions: true,
          staffRoleProfile: {
            select: { id: true, name: true, permissions: true, active: true },
          },
        },
      },
      branchAssignments: {
        select: {
          branchId: true,
          status: true,
          isPrimary: true,
          branch: { select: { id: true, name: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const membershipIds = memberships.map((membership) => membership.id);
  const accountIds = [...new Set(memberships.map((membership) => membership.employeeAccountId))];
  const [sessions, finalResults, expectedDays, exceptions, reviews, snapshots, rosterAssignments] =
    await Promise.all([
      prisma.employeeSession.findMany({
        where: { employeeAccountId: { in: accountIds }, businessId: input.businessId },
        select: {
          id: true,
          employeeAccountId: true,
          membershipId: true,
          primaryBranchId: true,
          attendanceBranchId: true,
          createdAt: true,
          lastActiveAt: true,
          expiresAt: true,
          revokedAt: true,
          revokeReason: true,
        },
        orderBy: { lastActiveAt: "desc" },
      }),
      prisma.attendanceP2FinalResult.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          workDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        orderBy: [{ workDate: "asc" }, { version: "asc" }],
      }),
      prisma.attendanceExpectedDay.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          workDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        orderBy: [{ workDate: "asc" }, { revision: "asc" }],
      }),
      prisma.attendanceP2Exception.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          workDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        orderBy: [{ workDate: "asc" }, { detectedAt: "asc" }],
      }),
      prisma.attendanceOvertimeReview.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          workDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        include: { events: { orderBy: { reviewRevision: "asc" } } },
        orderBy: { workDate: "asc" },
      }),
      prisma.attendanceTimesheetP2DaySnapshot.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          workDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        orderBy: { workDate: "asc" },
      }),
      prisma.rosterPublishedAssignment.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          workDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        orderBy: { workDate: "asc" },
      }),
    ]);
  const correctionRequests = exceptions.length
    ? await prisma.attendanceCorrectionRequest.findMany({
        where: { exceptionId: { in: exceptions.map((exception) => exception.id) } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return {
    currentAccountId: input.accountId,
    currentMembershipId: input.currentMembershipId,
    memberships,
    sessions,
    finalResults,
    expectedDays,
    exceptions,
    correctionRequests,
    reviews,
    snapshots,
    rosterAssignments,
  };
}

function constantTimeEqual(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

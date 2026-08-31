import { timingSafeEqual } from "node:crypto";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  materializeAttendanceP2Day,
  recordExpectedAttendance,
} from "@/lib/attendance/p2-service";
import { listAttendanceOvertimeCandidates } from "@/lib/attendance/overtime-service";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  decideStaffOvertime,
  getStaffOvertimeDetail,
  getStaffOvertimeQueue,
  getStaffOvertimeSummary,
  resolveStaffOvertimeAccess,
} from "@/lib/staff-pwa/overtime-approvals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedTestingDiagnostic(request)) {
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

export async function POST(request: Request) {
  if (!isAuthorizedTestingDiagnostic(request)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "repair-live-ot-identity-collision") {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const result = await repairLiveOtIdentityCollision();
  return Response.json(result, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

const LIVE_OT_FIXTURE = {
  businessId: "611b0c19-ebf7-4548-8a48-a3b6a7af8a81",
  branchId: "41575966-238f-46ab-a114-22bbee4949c5",
  currentAccountId: "7260972a-e431-4ea1-bc69-b604a997ef0a",
  currentMembershipId: "72f21dad-66d0-45fc-a326-2a8c5f55ffdb",
  legacyAccountId: "f0db56e5-79a8-4521-b1c5-12cc25c3863c",
  legacyMembershipId: "3ed1909b-f624-49cb-9457-efecec9e776a",
  legacyExpectedDayId: "dc95ad1a-73e4-4db3-b964-17e3f1dc1e3b",
  legacyFinalResultId: "cd04940c-3179-4dde-9033-4ed55ea47155",
  workDate: new Date("2026-08-21T00:00:00.000Z"),
  month: "2026-08",
} as const;

async function repairLiveOtIdentityCollision() {
  const fixture = LIVE_OT_FIXTURE;
  const [currentMembership, legacyMembership, legacyExpectedDay, legacyResult, existingReview, snapshot, timesheet] =
    await Promise.all([
      prisma.employeeBusinessMembership.findUnique({
        where: { id: fixture.currentMembershipId },
        select: {
          id: true,
          businessId: true,
          employeeAccountId: true,
          fullName: true,
          status: true,
          staffUser: { select: { id: true } },
          branchAssignments: {
            where: { branchId: fixture.branchId, status: "ACTIVE" },
            select: { id: true },
          },
        },
      }),
      prisma.employeeBusinessMembership.findUnique({
        where: { id: fixture.legacyMembershipId },
        select: {
          id: true,
          businessId: true,
          employeeAccountId: true,
          fullName: true,
          status: true,
          staffUser: { select: { id: true } },
        },
      }),
      prisma.attendanceExpectedDay.findUnique({ where: { id: fixture.legacyExpectedDayId } }),
      prisma.attendanceP2FinalResult.findUnique({ where: { id: fixture.legacyFinalResultId } }),
      prisma.attendanceOvertimeReview.findFirst({
        where: {
          businessId: fixture.businessId,
          OR: [
            { finalResultId: fixture.legacyFinalResultId },
            { membershipId: fixture.legacyMembershipId, workDate: fixture.workDate },
            { membershipId: fixture.currentMembershipId, workDate: fixture.workDate },
          ],
        },
        select: { id: true, status: true },
      }),
      prisma.attendanceTimesheetP2DaySnapshot.findFirst({
        where: { businessId: fixture.businessId, finalResultId: fixture.legacyFinalResultId },
        select: { id: true, revisionId: true },
      }),
      prisma.attendanceMonthlyTimesheet.findUnique({
        where: {
          businessId_periodStart: {
            businessId: fixture.businessId,
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
          },
        },
        select: { id: true, status: true, currentRevisionId: true },
      }),
    ]);

  if (
    !currentMembership ||
    currentMembership.businessId !== fixture.businessId ||
    currentMembership.employeeAccountId !== fixture.currentAccountId ||
    currentMembership.status !== "ACTIVE" ||
    currentMembership.branchAssignments.length !== 1 ||
    !currentMembership.staffUser
  ) throw new Error("CURRENT_MANAGER_MEMBERSHIP_CONTRACT_MISMATCH");
  if (
    !legacyMembership ||
    legacyMembership.businessId !== fixture.businessId ||
    legacyMembership.employeeAccountId !== fixture.legacyAccountId ||
    legacyMembership.status !== "ACTIVE" ||
    !legacyMembership.staffUser
  ) throw new Error("LEGACY_MANAGER_MEMBERSHIP_CONTRACT_MISMATCH");
  if (currentMembership.fullName !== legacyMembership.fullName) {
    throw new Error("MANAGER_PERSONA_NAME_COLLISION_NO_LONGER_EXISTS");
  }
  if (
    !legacyExpectedDay ||
    legacyExpectedDay.businessId !== fixture.businessId ||
    legacyExpectedDay.branchId !== fixture.branchId ||
    legacyExpectedDay.membershipId !== fixture.legacyMembershipId ||
    legacyExpectedDay.workDate.getTime() !== fixture.workDate.getTime()
  ) throw new Error("LEGACY_EXPECTED_DAY_CONTRACT_MISMATCH");
  if (
    !legacyResult ||
    legacyResult.businessId !== fixture.businessId ||
    legacyResult.branchId !== fixture.branchId ||
    legacyResult.membershipId !== fixture.legacyMembershipId ||
    legacyResult.workDate.getTime() !== fixture.workDate.getTime() ||
    legacyResult.expectedDayId !== legacyExpectedDay.id
  ) throw new Error("LEGACY_P2_FINAL_RESULT_CONTRACT_MISMATCH");
  if (existingReview) throw new Error("OT_FIXTURE_ALREADY_HAS_REVIEW");
  if (snapshot) throw new Error("OT_FIXTURE_ALREADY_IN_TIMESHEET_SNAPSHOT");
  if (timesheet?.status === "LOCKED") throw new Error("AUGUST_TIMESHEET_IS_LOCKED");

  const projectionActor = await prisma.user.findFirst({
    where: { id: legacyResult.createdById, businessId: fixture.businessId },
    select: { id: true, name: true, email: true },
  });
  if (!projectionActor) throw new Error("FIXTURE_PROJECTION_ACTOR_NOT_AVAILABLE");
  const context: AttendanceServiceContext = {
    businessId: fixture.businessId,
    allowedBranchIds: [fixture.branchId],
    wholeBusinessScope: false,
    actor: {
      userId: projectionActor.id,
      name: projectionActor.name,
      email: projectionActor.email ?? "",
    },
  };

  let currentExpected = await prisma.attendanceExpectedDay.findFirst({
    where: {
      businessId: fixture.businessId,
      membershipId: fixture.currentMembershipId,
      workDate: fixture.workDate,
      status: "CURRENT",
    },
    orderBy: { revision: "desc" },
  });
  if (!currentExpected) {
    currentExpected = await recordExpectedAttendance({
      context,
      input: {
        branchId: fixture.branchId,
        membershipId: fixture.currentMembershipId,
        workDate: fixture.workDate,
        kind: legacyExpectedDay.kind,
        source: "MANUAL_EVIDENCE",
        expectedStartAt: legacyExpectedDay.expectedStartAt,
        expectedEndAt: legacyExpectedDay.expectedEndAt,
        graceMinutes: legacyExpectedDay.graceMinutes,
        timezoneSnapshot: legacyExpectedDay.timezoneSnapshot,
        policySnapshot: legacyExpectedDay.policySnapshot,
        evidenceReference: "STAFF 3000 LIVE OT SELF-REVIEW FIXTURE RECONCILIATION",
      },
    });
  }

  let currentResult = await prisma.attendanceP2FinalResult.findFirst({
    where: {
      businessId: fixture.businessId,
      membershipId: fixture.currentMembershipId,
      workDate: fixture.workDate,
    },
    orderBy: { version: "desc" },
  });
  if (!currentResult) {
    currentResult = await prisma.$transaction(async (transaction) => {
      const created = await transaction.attendanceP2FinalResult.create({
        data: {
          businessId: fixture.businessId,
          branchId: fixture.branchId,
          membershipId: fixture.currentMembershipId,
          workDate: fixture.workDate,
          version: 1,
          outcome: legacyResult.outcome,
          expectedDayKindSnapshot: currentExpected.kind,
          expectedDayId: currentExpected.id,
          leaveRequestId: legacyResult.leaveRequestId,
          leaveDayFractionSnapshot: legacyResult.leaveDayFractionSnapshot,
          expectedStartAt: legacyResult.expectedStartAt,
          expectedEndAt: legacyResult.expectedEndAt,
          graceMinutesSnapshot: legacyResult.graceMinutesSnapshot,
          actualClockInAt: legacyResult.actualClockInAt,
          actualClockOutAt: legacyResult.actualClockOutAt,
          totalBreakMinutes: legacyResult.totalBreakMinutes,
          totalWorkedMinutes: legacyResult.totalWorkedMinutes,
          sourceDigest: legacyResult.sourceDigest,
          resolutionDigest: legacyResult.resolutionDigest,
          createdById: projectionActor.id,
        },
      });
      await writeAuditLog({
        businessId: fixture.businessId,
        branchId: fixture.branchId,
        actor: context.actor,
        action: "ATTENDANCE_TESTING_FIXTURE_RECONCILED",
        entityType: "AttendanceP2FinalResult",
        entityId: created.id,
        summary: "Testing-only OT evidence was assigned to the authenticated canonical employee identity without mutating legacy facts.",
        metadata: {
          sourceFinalResultId: legacyResult.id,
          sourceMembershipId: fixture.legacyMembershipId,
          canonicalMembershipId: fixture.currentMembershipId,
          workDate: "2026-08-21",
        },
      }, transaction);
      return created;
    });
  }

  let legacyCurrentExpected = await prisma.attendanceExpectedDay.findFirst({
    where: {
      businessId: fixture.businessId,
      membershipId: fixture.legacyMembershipId,
      workDate: fixture.workDate,
      status: "CURRENT",
    },
    orderBy: { revision: "desc" },
  });
  if (legacyCurrentExpected?.kind !== "NOT_SCHEDULED") {
    legacyCurrentExpected = await recordExpectedAttendance({
      context,
      input: {
        branchId: fixture.branchId,
        membershipId: fixture.legacyMembershipId,
        workDate: fixture.workDate,
        kind: "NOT_SCHEDULED",
        source: "MANUAL_EVIDENCE",
        expectedStartAt: null,
        expectedEndAt: null,
        graceMinutes: 0,
        timezoneSnapshot: legacyExpectedDay.timezoneSnapshot,
        evidenceReference: "STAFF 3000 LIVE OT DUPLICATE PERSONA RETIREMENT",
      },
    });
  }
  if (!legacyCurrentExpected) throw new Error("LEGACY_EXPECTED_DAY_RETIREMENT_FAILED");

  let legacyLatestResult = await prisma.attendanceP2FinalResult.findFirst({
    where: {
      businessId: fixture.businessId,
      membershipId: fixture.legacyMembershipId,
      workDate: fixture.workDate,
    },
    orderBy: { version: "desc" },
  });
  if (
    legacyLatestResult?.expectedDayId !== legacyCurrentExpected.id ||
    legacyLatestResult.outcome !== "NOT_SCHEDULED"
  ) {
    const projection = await materializeAttendanceP2Day({
      context,
      membershipId: fixture.legacyMembershipId,
      workDate: fixture.workDate,
    });
    if (!projection.finalResult) throw new Error("LEGACY_FIXTURE_RETIREMENT_DID_NOT_MATERIALIZE");
    legacyLatestResult = projection.finalResult;
  }

  const repair = {
    applied: true,
    immutableLegacyExpectedDayId: legacyExpectedDay.id,
    immutableLegacyFinalResultId: legacyResult.id,
    canonicalExpectedDayId: currentExpected.id,
    canonicalFinalResultId: currentResult.id,
    retiringExpectedDayId: legacyCurrentExpected.id,
    retiringFinalResultId: legacyLatestResult.id,
    timesheet: timesheet ?? null,
    reviewPresent: false,
    snapshotPresent: false,
  };

  const currentSession = await prisma.employeeSession.findFirst({
    where: {
      employeeAccountId: fixture.currentAccountId,
      membershipId: fixture.currentMembershipId,
      businessId: fixture.businessId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastActiveAt: "desc" },
  });
  if (!currentSession || !currentMembership.staffUser || !legacyMembership.staffUser) {
    throw new Error("POST_REPAIR_REVIEWER_CONTEXT_UNAVAILABLE");
  }
  const currentAuth: EmployeeAuthContext = {
    sessionId: currentSession.id,
    employeeAccountId: fixture.currentAccountId,
    membershipId: fixture.currentMembershipId,
    businessId: fixture.businessId,
    primaryBranchId: fixture.branchId,
    attendanceBranchId: fixture.branchId,
    deviceId: currentSession.employeeDeviceId ?? "diagnostic-current-reviewer",
  };
  const otherReviewerAuth: EmployeeAuthContext = {
    sessionId: "diagnostic-other-reviewer",
    employeeAccountId: fixture.legacyAccountId,
    membershipId: fixture.legacyMembershipId,
    businessId: fixture.businessId,
    primaryBranchId: fixture.branchId,
    attendanceBranchId: fixture.branchId,
    deviceId: "diagnostic-other-reviewer",
  };
  const [currentQueue, currentSummary, currentDetail, otherReviewerQueue] = await Promise.all([
    getStaffOvertimeQueue({ auth: currentAuth, month: fixture.month }),
    getStaffOvertimeSummary(currentAuth),
    getStaffOvertimeDetail(currentAuth, currentResult.id),
    getStaffOvertimeQueue({ auth: otherReviewerAuth, month: fixture.month }),
  ]);
  const writeGuardResults = await Promise.all(
    (["APPROVE", "ADJUST", "REJECT"] as const).map(async (decision) => {
      try {
        await decideStaffOvertime({
          auth: currentAuth,
          finalResultId: currentResult.id,
          expectedRevision: 0,
          decision,
          approvedMinutes: decision === "ADJUST" ? 60 : undefined,
          reason: decision === "APPROVE" ? undefined : "Testing-only self-review guard verification",
        });
        return { decision, blocked: false, errorCode: null, errorMessage: null };
      } catch (error) {
        const value = error as { code?: string; message?: string };
        return {
          decision,
          blocked: true,
          errorCode: value.code ?? null,
          errorMessage: value.message ?? String(error),
        };
      }
    }),
  );
  const persistedReview = await prisma.attendanceOvertimeReview.findFirst({
    where: {
      businessId: fixture.businessId,
      membershipId: fixture.currentMembershipId,
      workDate: fixture.workDate,
    },
    select: { id: true, status: true, revision: true },
  });

  return {
    capturedAt: new Date(),
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    repair,
    currentReviewer: {
      queuePending: currentQueue?.pending ?? null,
      queueContainsFixture: currentQueue?.items.some((item) => item.finalResultId === currentResult.id) ?? null,
      summary: currentSummary,
      detailVisible: Boolean(currentDetail),
      writeGuardResults,
      persistedReview,
    },
    otherReviewer: {
      queuePending: otherReviewerQueue?.pending ?? null,
      queueContainsFixture: otherReviewerQueue?.items.some((item) => item.finalResultId === currentResult.id) ?? null,
    },
  };
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

function isAuthorizedTestingDiagnostic(request: Request) {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") return false;
  const expectedToken = process.env.OT_DIAGNOSTIC_TOKEN;
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expectedToken && constantTimeEqual(expectedToken, suppliedToken));
}

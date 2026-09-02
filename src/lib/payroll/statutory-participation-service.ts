import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { generatePayrollRun } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";
import type { PayrollProfileWriteContext } from "./employee-profile-write/types";
import {
  monthStart,
  statutoryParticipationDigest,
  validateStatutoryParticipationPeriod,
  STATUTORY_PARTICIPATION_BLOCKERS,
} from "./statutory-participation";

const commandSchema = z.object({
  effectiveFromMonth: z.coerce.date(),
  effectiveToMonth: z.coerce.date().nullable().default(null),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
  scheme: z.literal("EPF"),
  sourceReference: z.string().trim().min(3).max(500).nullable().default(null),
  sourceType: z.enum([
    "OFFICIAL_RECORD",
    "EMPLOYMENT_CHANGE",
    "EMPLOYEE_DECLARATION",
    "LEGACY_REVIEW",
    "OTHER",
  ]),
  status: z.enum(["PARTICIPATING", "NOT_PARTICIPATING"]),
});

export type RecordStatutoryParticipationCommand = z.input<typeof commandSchema>;
type ParticipationDatabase = PrismaClient | Prisma.TransactionClient;

export async function recordEmployeeStatutoryParticipationAndRefreshDrafts(
  input: {
    command: RecordStatutoryParticipationCommand;
    context: PayrollProfileWriteContext;
  },
  database: PrismaClient = prisma,
) {
  const participation = await recordEmployeeStatutoryParticipation(input, database);
  const draftRuns = await database.payrollRun.findMany({
    where: {
      businessId: input.context.businessId,
      periodStart: { gte: participation.effectiveFromMonth },
      status: "DRAFT",
    },
    select: { periodStart: true },
    orderBy: { periodStart: "asc" },
  });
  let refreshedDrafts = 0;
  for (const draft of draftRuns) {
    const month = `${draft.periodStart.getUTCFullYear()}-${String(
      draft.periodStart.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    try {
      await generatePayrollRun(
        {
          actor: input.context.actor,
          businessId: input.context.businessId,
          month,
          request: input.context.request,
        },
        database,
      );
      refreshedDrafts += 1;
    } catch {
      // The governed record remains valid when an existing Draft can no
      // longer be regenerated (for example after its Timesheet unlocks).
    }
  }
  return { participation, draftCount: draftRuns.length, refreshedDrafts };
}

export async function recordEmployeeStatutoryParticipation(
  input: {
    command: RecordStatutoryParticipationCommand;
    context: PayrollProfileWriteContext;
  },
  database: ParticipationDatabase = prisma,
) {
  const command = commandSchema.parse(input.command);
  if (
    !hasBusinessCapability(input.context.access, "VIEW_STATUTORY_PROFILE") ||
    !hasBusinessCapability(input.context.access, "EDIT_STATUTORY_PROFILE")
  ) {
    throw new Error("STATUTORY_PARTICIPATION_PERMISSION_REQUIRED");
  }
  const activeBranchCount = await database.branch.count({
    where: { businessId: input.context.businessId, status: "ACTIVE" },
  });
  const hasWholeBusinessScope =
    input.context.allowedBranchIds.length === activeBranchCount &&
    !(
      input.context.access.granted &&
      input.context.access.effectiveBusinessRole === "STAFF" &&
      !input.context.access.permissions.includes("ALL_BRANCHES")
    );
  if (!hasWholeBusinessScope) {
    throw new Error("STATUTORY_PARTICIPATION_WHOLE_BUSINESS_SCOPE_REQUIRED");
  }

  const write = async (transaction: Prisma.TransactionClient) => {
    const membership = await transaction.employeeBusinessMembership.findFirst({
      where: { id: command.membershipId, businessId: input.context.businessId },
      select: { id: true, businessId: true },
    });
    if (!membership) throw new Error("STATUTORY_PARTICIPATION_MEMBERSHIP_NOT_FOUND");

    const effectiveFromMonth = monthStart(command.effectiveFromMonth);
    const effectiveToMonth = command.effectiveToMonth
      ? monthStart(command.effectiveToMonth)
      : null;
    validateStatutoryParticipationPeriod({
      effectiveFromMonth,
      effectiveToMonth,
      sourceReference: command.sourceReference,
      sourceType: command.sourceType,
    });

    const previous = await transaction.employeeStatutoryParticipationPeriod.findFirst({
      where: {
        businessId: input.context.businessId,
        membershipId: membership.id,
        scheme: command.scheme,
      },
      orderBy: [{ revision: "desc" }, { recordedAt: "desc" }],
    });
    if ((previous?.revision ?? 0) !== command.expectedRevision) {
      throw new Error("STATUTORY_PARTICIPATION_REVISION_CONFLICT");
    }
    if (
      previous &&
      effectiveFromMonth.getTime() <= monthStart(previous.effectiveFromMonth).getTime()
    ) {
      throw new Error(STATUTORY_PARTICIPATION_BLOCKERS.OVERLAP);
    }
    if (
      previous?.effectiveToMonth &&
      monthStart(previous.effectiveToMonth).getTime() > effectiveFromMonth.getTime()
    ) {
      throw new Error(STATUTORY_PARTICIPATION_BLOCKERS.OVERLAP);
    }

    const revision = (previous?.revision ?? 0) + 1;
    const confirmedAt = new Date();
    const next = {
      businessId: input.context.businessId,
      membershipId: membership.id,
      scheme: command.scheme,
      revision,
      effectiveFromMonth,
      effectiveToMonth,
      status: command.status,
      sourceType: command.sourceType,
      sourceReference: command.sourceReference,
      reason: command.reason,
      confirmedAt,
    };
    const sourceDigest = statutoryParticipationDigest(next);

    if (previous && previous.effectiveToMonth === null) {
      await transaction.employeeStatutoryParticipationPeriod.update({
        where: { id: previous.id },
        data: { effectiveToMonth: effectiveFromMonth, supersededAt: confirmedAt },
      });
    }
    const created = await transaction.employeeStatutoryParticipationPeriod.create({
      data: {
        ...next,
        sourceDigest,
        recordedById: input.context.actor.userId,
        confirmedById: input.context.actor.userId,
        supersedesPeriodId: previous?.id ?? null,
      },
    });
    await writeAuditLog(
      {
        businessId: input.context.businessId,
        actor: input.context.actor,
        request: input.context.request,
        action: "EMPLOYEE_STATUTORY_PARTICIPATION_RECORDED",
        entityType: "EmployeeStatutoryParticipationPeriod",
        entityId: created.id,
        summary: "Effective-dated statutory participation recorded.",
        before: previous
          ? {
              id: previous.id,
              scheme: previous.scheme,
              status: previous.status,
              effectiveFromMonth: previous.effectiveFromMonth,
              effectiveToMonth: previous.effectiveToMonth,
              revision: previous.revision,
            }
          : null,
        after: {
          id: created.id,
          scheme: created.scheme,
          status: created.status,
          effectiveFromMonth: created.effectiveFromMonth,
          effectiveToMonth: created.effectiveToMonth,
          revision: created.revision,
        },
        metadata: {
          membershipId: membership.id,
          sourceType: created.sourceType,
          sourceReference: created.sourceReference,
          reason: created.reason,
          sourceDigest,
        },
      },
      transaction,
    );
    return created;
  };

  if ("$transaction" in database) {
    return database.$transaction(write, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
  return write(database);
}

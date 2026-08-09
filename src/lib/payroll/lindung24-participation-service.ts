import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import type { PayrollProfileWriteContext } from "./employee-profile-write/types";
import {
  LINDUNG24_BLOCKERS,
  lindung24ParticipationDigest,
  monthStart,
  validateLindung24ParticipationChange,
  type Lindung24ParticipationEvidence,
} from "./lindung24-participation";

const commandSchema = z.object({
  act4Covered: z.boolean(),
  effectiveFromMonth: z.coerce.date(),
  employerContext: z.enum(["SINGLE_EMPLOYER", "MULTIPLE_EMPLOYER"]),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  officialSubmittedAt: z.coerce.date().nullable(),
  reason: z.string().trim().min(5).max(500),
  selectedEmployer: z.enum([
    "CURRENT_BUSINESS",
    "OTHER_EMPLOYER",
    "PERKESO_SELECTION_PENDING",
  ]),
  sourceReference: z.string().trim().min(5).max(500),
  sourceType: z.enum([
    "OFFICIAL_TRANSITION",
    "EMPLOYEE_OPT_IN",
    "EMPLOYEE_OPT_OUT",
    "PERKESO_EMPLOYER_SELECTION",
    "EMPLOYMENT_CHANGE",
    "LEGACY_REVIEW",
  ]),
  status: z.enum([
    "MANDATORY",
    "DEFAULT_PARTICIPATING",
    "VOLUNTARY_OPT_IN",
    "VOLUNTARY_OPT_OUT",
  ]),
});

export type RecordLindung24ParticipationCommand = z.input<typeof commandSchema>;

export async function recordEmployeeLindung24Participation(
  input: {
    command: RecordLindung24ParticipationCommand;
    context: PayrollProfileWriteContext;
  },
  database: PrismaClient = prisma,
) {
  const command = commandSchema.parse(input.command);
  if (
    !hasBusinessCapability(input.context.access, "VIEW_STATUTORY_PROFILE") ||
    !hasBusinessCapability(input.context.access, "EDIT_STATUTORY_PROFILE")
  ) {
    throw new Error("LINDUNG24_STATUTORY_PERMISSION_REQUIRED");
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
  if (!hasWholeBusinessScope) throw new Error("LINDUNG24_WHOLE_BUSINESS_SCOPE_REQUIRED");

  return database.$transaction(
    async (transaction) => {
      const membership = await transaction.employeeBusinessMembership.findFirst({
        where: { id: command.membershipId, businessId: input.context.businessId },
        select: { id: true, businessId: true, statutoryNationality: true },
      });
      if (!membership) throw new Error("LINDUNG24_MEMBERSHIP_NOT_FOUND");
      if (!membership.statutoryNationality) {
        throw new Error(LINDUNG24_BLOCKERS.PROFILE_INCOMPLETE);
      }

      const previous = await transaction.employeeLindung24ParticipationVersion.findFirst({
        where: {
          businessId: input.context.businessId,
          membershipId: membership.id,
          effectiveToMonth: null,
        },
        orderBy: [{ revision: "desc" }, { recordedAt: "desc" }],
      });
      if ((previous?.revision ?? 0) !== command.expectedRevision) {
        throw new Error("LINDUNG24_PARTICIPATION_REVISION_CONFLICT");
      }

      const effectiveFromMonth = monthStart(command.effectiveFromMonth);
      const nextWithoutIdentity = {
        act4Covered: command.act4Covered,
        businessId: input.context.businessId,
        effectiveFromMonth,
        effectiveToMonth: null,
        employerContext: command.employerContext,
        membershipId: membership.id,
        officialSubmittedAt: command.officialSubmittedAt,
        reason: command.reason,
        selectedEmployer: command.selectedEmployer,
        sourceReference: command.sourceReference,
        sourceType: command.sourceType,
        status: command.status,
      };
      const hasPriorCalculatedContribution = Boolean(
        await transaction.payrollEntryStatutorySnapshot.findFirst({
          where: {
            businessId: input.context.businessId,
            membershipId: membership.id,
            scheme: "LINDUNG24",
            status: "CALCULATED",
          },
          select: { id: true },
        }),
      );
      validateLindung24ParticipationChange({
        next: nextWithoutIdentity,
        previous: previous as Lindung24ParticipationEvidence | null,
        hasPriorCalculatedContribution,
        employeeCategory:
          membership.statutoryNationality === "NON_MALAYSIAN" ? "FOREIGN" : "LOCAL",
      });

      const revision = (previous?.revision ?? 0) + 1;
      const sourceDigest = lindung24ParticipationDigest({
        ...nextWithoutIdentity,
        revision,
      });
      const now = new Date();
      if (previous) {
        await transaction.employeeLindung24ParticipationVersion.update({
          where: { id: previous.id },
          data: { effectiveToMonth: effectiveFromMonth, supersededAt: now },
        });
      }
      const created = await transaction.employeeLindung24ParticipationVersion.create({
        data: {
          ...nextWithoutIdentity,
          revision,
          sourceDigest,
          recordedById: input.context.actor.userId,
          supersedesVersionId: previous?.id ?? null,
        },
      });
      await writeAuditLog(
        {
          businessId: input.context.businessId,
          actor: input.context.actor,
          request: input.context.request,
          action: "EMPLOYEE_LINDUNG24_PARTICIPATION_RECORDED",
          entityType: "EmployeeLindung24ParticipationVersion",
          entityId: created.id,
          summary: "Effective-dated LINDUNG24 participation evidence recorded.",
          metadata: {
            membershipId: membership.id,
            revision,
            effectiveFromMonth: effectiveFromMonth.toISOString().slice(0, 10),
            status: created.status,
            employerContext: created.employerContext,
            selectedEmployer: created.selectedEmployer,
            sourceType: created.sourceType,
            sourceDigest,
            supersedesVersionId: previous?.id ?? null,
          },
        },
        transaction,
      );
      return created;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

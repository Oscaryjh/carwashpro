import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { RosterError, type RosterServiceContext } from "./service";

export const rosterShiftColors = ["TEAL", "BLUE", "VIOLET", "AMBER", "ROSE", "SLATE"] as const;

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
  branchId: z.string().uuid().nullable(),
  name: z.string().trim().min(2).max(80),
  shortCode: z.string().trim().max(12).nullable().optional(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  breakMinutes: z.number().int().min(0).max(720),
  breakPaid: z.boolean().default(false),
  colorToken: z.enum(rosterShiftColors),
  active: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(2_000_000_000).optional(),
});

export async function listRosterShiftTemplates(args: {
  context: Pick<RosterServiceContext, "businessId" | "allowedBranchIds">;
  branchId?: string;
  includeInactive?: boolean;
  database?: PrismaClient;
}) {
  if (args.branchId && !args.context.allowedBranchIds.includes(args.branchId)) {
    throw new RosterError("OUTSIDE_SCOPE", "Shift template branch is outside the authorised scope.");
  }
  const database = args.database ?? prisma;
  return database.rosterShiftTemplate.findMany({
    where: {
      businessId: args.context.businessId,
      OR: [
        { branchId: null },
        { branchId: args.branchId ? args.branchId : { in: [...args.context.allowedBranchIds] } },
      ],
      ...(args.includeInactive ? {} : { active: true }),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ active: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function saveRosterShiftTemplate(args: {
  context: RosterServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const input = templateSchema.parse(args.input);
  if (input.startMinute === input.endMinute) {
    throw new RosterError("INVALID_ASSIGNMENT", "Shift start and end cannot be the same time.");
  }
  const durationMinutes = input.endMinute <= input.startMinute
    ? input.endMinute + 1440 - input.startMinute
    : input.endMinute - input.startMinute;
  if (input.breakMinutes >= durationMinutes) {
    throw new RosterError("INVALID_ASSIGNMENT", "Shift break must be shorter than the shift duration.");
  }
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    await assertTemplateBranchScope(transaction, args.context, input.branchId);
    const existing = input.id
      ? await transaction.rosterShiftTemplate.findFirst({
          where: { id: input.id, businessId: args.context.businessId },
        })
      : null;
    if (input.id && !existing) throw new RosterError("NOT_FOUND", "Shift template was not found.");
    if (existing?.branchId && !args.context.allowedBranchIds.includes(existing.branchId)) {
      throw new RosterError("OUTSIDE_SCOPE", "Shift template is outside the authorised branch scope.");
    }
    if (existing && input.expectedRevision !== existing.revision) {
      throw new RosterError("CONCURRENT_CHANGE", "This shift template changed in another session. Reload before saving.");
    }
    const duplicate = await transaction.rosterShiftTemplate.findFirst({
      where: {
        businessId: args.context.businessId,
        branchId: input.branchId,
        name: { equals: input.name, mode: "insensitive" },
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new RosterError("INVALID_ASSIGNMENT", "A shift template with this name already exists in the same scope.");
    const displayOrder = existing
      ? input.displayOrder ?? existing.displayOrder
      : input.displayOrder ?? await nextTemplateDisplayOrder(transaction, args.context.businessId, input.branchId);
    const data = {
      branchId: input.branchId,
      name: input.name,
      shortCode: input.shortCode || null,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      breakMinutes: input.breakMinutes,
      breakPaid: input.breakPaid,
      colorToken: input.colorToken,
      crossMidnight: input.endMinute < input.startMinute,
      active: input.active,
      displayOrder,
      updatedById: args.context.actor.userId,
    } as const;
    const template = existing
      ? await transaction.rosterShiftTemplate.update({
          where: { id: existing.id },
          data: { ...data, revision: { increment: 1 } },
        })
      : await transaction.rosterShiftTemplate.create({
          data: {
            businessId: args.context.businessId,
            createdById: args.context.actor.userId,
            ...data,
          },
        });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: input.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: existing ? "SHIFT_TEMPLATE_UPDATED" : "SHIFT_TEMPLATE_CREATED",
      entityType: "RosterShiftTemplate",
      entityId: template.id,
      summary: existing ? "Roster shift template updated with a new revision." : "Roster shift template created.",
      before: existing ? templateAuditShape(existing) : undefined,
      after: templateAuditShape(template),
      metadata: { historicalRosterSnapshotsChanged: false },
    }, transaction);
    return template;
  });
}

async function nextTemplateDisplayOrder(
  transaction: Prisma.TransactionClient,
  businessId: string,
  branchId: string | null,
) {
  const latest = await transaction.rosterShiftTemplate.aggregate({
    where: { businessId, branchId },
    _max: { displayOrder: true },
  });
  return Math.min(2_000_000_000, (latest._max.displayOrder ?? 0) + 100);
}

async function assertTemplateBranchScope(
  transaction: Prisma.TransactionClient,
  context: Pick<RosterServiceContext, "businessId" | "allowedBranchIds">,
  branchId: string | null,
) {
  if (branchId) {
    if (!context.allowedBranchIds.includes(branchId)) {
      throw new RosterError("OUTSIDE_SCOPE", "Shift template branch is outside the authorised scope.");
    }
    const branch = await transaction.branch.findFirst({
      where: { id: branchId, businessId: context.businessId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!branch) throw new RosterError("OUTSIDE_SCOPE", "Shift template branch is not active.");
    return;
  }
  const activeBranches = await transaction.branch.count({ where: { businessId: context.businessId, status: "ACTIVE" } });
  if (activeBranches !== context.allowedBranchIds.length) {
    throw new RosterError("OUTSIDE_SCOPE", "Business-wide shift templates require access to every active branch.");
  }
}

function templateAuditShape(value: {
  branchId: string | null;
  name: string;
  shortCode?: string | null;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  breakPaid?: boolean;
  colorToken: string;
  crossMidnight: boolean;
  active: boolean;
  displayOrder?: number;
  revision: number;
}) {
  return {
    branchId: value.branchId,
    name: value.name,
    shortCode: value.shortCode ?? null,
    startMinute: value.startMinute,
    endMinute: value.endMinute,
    breakMinutes: value.breakMinutes,
    breakPaid: value.breakPaid ?? false,
    colorToken: value.colorToken,
    crossMidnight: value.crossMidnight,
    active: value.active,
    displayOrder: value.displayOrder ?? 100,
    revision: value.revision,
  };
}

async function runSerializable<T>(database: PrismaClient, operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  return database.$transaction(operation, {
    isolationLevel: "Serializable",
    maxWait: 5_000,
    timeout: 30_000,
  });
}

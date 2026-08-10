import {
  BusinessModuleEntitlementSource,
  BusinessModuleEntitlementStatus,
  Prisma,
  type BusinessIndustry,
} from "@prisma/client";
import { z } from "zod";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  MODULE_REGISTRY,
  defaultModulesForNewBusiness,
  moduleDependents,
  moduleKeys,
  type ModuleKey,
} from "./registry";

export const MODULE_DEPENDENCY_REQUIRED = "MODULE_DEPENDENCY_REQUIRED";
export const DEPENDENT_MODULE_ENABLED = "DEPENDENT_MODULE_ENABLED";
export const CORE_MODULE_SYSTEM_REQUIRED = "CORE_MODULE_SYSTEM_REQUIRED";
export const MODULE_ENTITLEMENT_UPDATED = "MODULE_ENTITLEMENT_UPDATED";

const changeSchema = z
  .object({
    businessId: z.string().uuid(),
    moduleKey: z.enum(moduleKeys),
    status: z.nativeEnum(BusinessModuleEntitlementStatus),
    enabledFrom: z.coerce.date(),
    enabledUntil: z.union([z.literal(""), z.coerce.date(), z.null()]).optional(),
    source: z.nativeEnum(BusinessModuleEntitlementSource).default("MANUAL"),
    planCode: z.string().trim().max(80).optional().nullable(),
    reason: z.string().trim().min(3).max(500),
    expectedRevision: z.coerce.number().int().positive().optional(),
  })
  .superRefine((value, context) => {
    if (value.enabledUntil instanceof Date && value.enabledUntil <= value.enabledFrom) {
      context.addIssue({ code: "custom", message: "Enabled until must be after enabled from.", path: ["enabledUntil"] });
    }
  });

export async function getBusinessModuleAdminView(businessId: string) {
  const [business, entitlements] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, industryType: true } }),
    prisma.businessModuleEntitlement.findMany({
      where: { businessId },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { moduleKey: "asc" },
    }),
  ]);
  if (!business) throw new Error("Business not found.");
  const byKey = new Map(entitlements.map((entitlement) => [entitlement.moduleKey as ModuleKey, entitlement]));
  return {
    business,
    modules: moduleKeys.map((key) => ({ definition: MODULE_REGISTRY[key], entitlement: byKey.get(key) ?? null })),
  };
}

export async function changeBusinessModuleEntitlement(input: {
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = changeSchema.parse(input.rawInput);
  if (data.moduleKey === "CORE") throw new Error(CORE_MODULE_SYSTEM_REQUIRED);
  const enabledUntil = data.enabledUntil instanceof Date ? data.enabledUntil : null;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`business-module:${data.businessId}`}, 0))`;
      const business = await tx.business.findUnique({ where: { id: data.businessId }, select: { id: true, name: true } });
      if (!business) throw new Error("Business not found.");

      const all = await tx.businessModuleEntitlement.findMany({ where: { businessId: data.businessId } });
      const current = all.find((row) => row.moduleKey === data.moduleKey) ?? null;
      if (data.expectedRevision !== undefined && current?.revision !== data.expectedRevision) {
        throw new Error(MODULE_ENTITLEMENT_UPDATED);
      }

      if (data.status === "ENABLED") {
        for (const dependency of MODULE_REGISTRY[data.moduleKey].dependencies) {
          const dependencyRow = all.find((row) => row.moduleKey === dependency);
          if (!dependencyRow || !coversWindow(dependencyRow, data.enabledFrom, enabledUntil)) {
            throw new Error(`${MODULE_DEPENDENCY_REQUIRED}: ${data.moduleKey} requires ${dependency}.`);
          }
        }
      } else {
        for (const dependent of moduleDependents(data.moduleKey)) {
          const dependentRow = all.find((row) => row.moduleKey === dependent);
          if (
            dependentRow &&
            dependentRow.status === "ENABLED" &&
            (dependentRow.enabledUntil === null || dependentRow.enabledUntil > new Date())
          ) {
            throw new Error(`${DEPENDENT_MODULE_ENABLED}: disable ${dependent} before ${data.moduleKey}.`);
          }
        }
      }

      if (
        current &&
        current.status === data.status &&
        current.enabledFrom.getTime() === data.enabledFrom.getTime() &&
        sameTime(current.enabledUntil, enabledUntil) &&
        current.source === data.source &&
        (current.planCode ?? null) === (data.planCode || null)
      ) {
        return { changed: false, entitlement: current };
      }

      const revision = current ? current.revision + 1 : 1;
      const entitlement = current
        ? await tx.businessModuleEntitlement.update({
            where: { id: current.id },
            data: {
              status: data.status,
              enabledFrom: data.enabledFrom,
              enabledUntil,
              source: data.source,
              planCode: data.planCode || null,
              revision,
              updatedById: input.actor.userId,
            },
          })
        : await tx.businessModuleEntitlement.create({
            data: {
              businessId: data.businessId,
              moduleKey: data.moduleKey,
              status: data.status,
              enabledFrom: data.enabledFrom,
              enabledUntil,
              source: data.source,
              planCode: data.planCode || null,
              revision,
              createdById: input.actor.userId,
              updatedById: input.actor.userId,
            },
          });

      await tx.businessModuleEntitlementEvent.create({
        data: {
          entitlementId: entitlement.id,
          businessId: data.businessId,
          moduleKey: data.moduleKey,
          revision,
          oldStatus: current?.status ?? null,
          newStatus: data.status,
          oldEnabledFrom: current?.enabledFrom ?? null,
          newEnabledFrom: data.enabledFrom,
          oldEnabledUntil: current?.enabledUntil ?? null,
          newEnabledUntil: enabledUntil,
          source: data.source,
          planCode: data.planCode || null,
          reason: data.reason,
          actorUserId: input.actor.userId,
        },
      });
      await writeAuditLog(
        {
          businessId: data.businessId,
          actor: input.actor,
          request: input.request,
          action: "BUSINESS_MODULE_ENTITLEMENT_CHANGED",
          entityType: "BusinessModuleEntitlement",
          entityId: entitlement.id,
          summary: `${data.moduleKey} module changed to ${data.status}.`,
          before: current
            ? { status: current.status, enabledFrom: current.enabledFrom, enabledUntil: current.enabledUntil, revision: current.revision }
            : null,
          after: { status: data.status, enabledFrom: data.enabledFrom, enabledUntil, revision, source: data.source },
          metadata: { moduleKey: data.moduleKey, reason: data.reason, planCode: data.planCode || null },
        },
        tx,
      );
      return { changed: true, entitlement };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function provisionDefaultBusinessModules(input: {
  transaction: Prisma.TransactionClient;
  businessId: string;
  industryType: BusinessIndustry;
  actorUserId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  for (const moduleKey of defaultModulesForNewBusiness(input.industryType)) {
    const entitlement = await input.transaction.businessModuleEntitlement.create({
      data: {
        businessId: input.businessId,
        moduleKey,
        status: "ENABLED",
        enabledFrom: now,
        source: "SYSTEM",
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      },
    });
    await input.transaction.businessModuleEntitlementEvent.create({
      data: {
        entitlementId: entitlement.id,
        businessId: input.businessId,
        moduleKey,
        revision: 1,
        newStatus: "ENABLED",
        newEnabledFrom: now,
        source: "SYSTEM",
        reason: "Default module profile selected during business provisioning.",
        actorUserId: input.actorUserId,
      },
    });
  }
}

function coversWindow(
  row: { status: BusinessModuleEntitlementStatus; enabledFrom: Date; enabledUntil: Date | null },
  from: Date,
  until: Date | null,
) {
  if (row.status !== "ENABLED" || row.enabledFrom > from) return false;
  if (until === null) return row.enabledUntil === null;
  return row.enabledUntil === null || row.enabledUntil >= until;
}

function sameTime(left: Date | null, right: Date | null) {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

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
export const DEFAULT_MANUAL_ENTITLEMENT_REASON =
  "Manual module entitlement update.";

const optionalReasonSchema = z
  .preprocess(
    (value) =>
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().min(3).max(500).optional(),
  )
  .transform((value) => value ?? DEFAULT_MANUAL_ENTITLEMENT_REASON);

const changeSchema = z
  .object({
    businessId: z.string().uuid(),
    moduleKey: z.enum(moduleKeys),
    status: z.nativeEnum(BusinessModuleEntitlementStatus),
    enabledFrom: z.coerce.date(),
    enabledUntil: z.union([z.literal(""), z.coerce.date(), z.null()]).optional(),
    source: z.nativeEnum(BusinessModuleEntitlementSource).default("MANUAL"),
    planCode: z.string().trim().max(80).optional().nullable(),
    reason: optionalReasonSchema,
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
  const batch = await changeBusinessModuleEntitlements({
    actor: input.actor,
    request: input.request,
    rawInputs: [input.rawInput],
  });
  return batch.results[0];
}

export async function changeBusinessModuleEntitlements(input: {
  actor: AppSession;
  request?: AuditRequestContext;
  rawInputs: unknown[];
}) {
  const parsed = z.array(changeSchema).min(1).max(moduleKeys.length).parse(input.rawInputs);
  const submittedKeys = new Set<ModuleKey>();

  for (const data of parsed) {
    if (data.moduleKey === "CORE") throw new Error(CORE_MODULE_SYSTEM_REQUIRED);
    if (submittedKeys.has(data.moduleKey)) {
      throw new Error(`Duplicate module entitlement input: ${data.moduleKey}.`);
    }
    submittedKeys.add(data.moduleKey);
  }

  const changes = parsed.map((data) => ({
    ...data,
    enabledUntil: data.enabledUntil instanceof Date ? data.enabledUntil : null,
  }));
  const businessIds = new Set(changes.map((data) => data.businessId));
  if (businessIds.size !== 1) {
    throw new Error("Batch entitlement changes must belong to one business.");
  }
  const businessId = changes[0].businessId;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`business-module:${businessId}`}, 0))`;
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
      if (!business) throw new Error("Business not found.");

      const all = await tx.businessModuleEntitlement.findMany({ where: { businessId } });
      const currentByKey = new Map(
        all.map((entitlement) => [entitlement.moduleKey as ModuleKey, entitlement]),
      );
      const projected = new Map<
        ModuleKey,
        { status: BusinessModuleEntitlementStatus; enabledFrom: Date; enabledUntil: Date | null }
      >(all.map((entitlement) => [entitlement.moduleKey as ModuleKey, entitlement]));

      for (const data of changes) {
        const current = currentByKey.get(data.moduleKey) ?? null;
        if (data.expectedRevision !== undefined && current?.revision !== data.expectedRevision) {
          throw new Error(MODULE_ENTITLEMENT_UPDATED);
        }
        projected.set(data.moduleKey, {
          status: data.status,
          enabledFrom: data.enabledFrom,
          enabledUntil: data.enabledUntil,
        });
      }

      const changedInputs = changes.filter(
        (data) => !sameEntitlementState(currentByKey.get(data.moduleKey) ?? null, data),
      );
      const validationTime = new Date();

      for (const data of changedInputs) {
        if (data.status === "ENABLED") {
          for (const dependency of MODULE_REGISTRY[data.moduleKey].dependencies) {
            if (dependency === "CORE") continue;
            const dependencyRow = projected.get(dependency);
            if (!dependencyRow || !coversWindow(dependencyRow, data.enabledFrom, data.enabledUntil)) {
              throw new Error(`${MODULE_DEPENDENCY_REQUIRED}: ${data.moduleKey} requires ${dependency}.`);
            }
          }
        } else {
          for (const dependent of moduleDependents(data.moduleKey)) {
            const dependentRow = projected.get(dependent);
            if (
              dependentRow &&
              dependentRow.status === "ENABLED" &&
              (dependentRow.enabledUntil === null || dependentRow.enabledUntil > validationTime)
            ) {
              throw new Error(`${DEPENDENT_MODULE_ENABLED}: disable ${dependent} before ${data.moduleKey}.`);
            }
          }
        }
      }

      const changedKeys = new Set(changedInputs.map((data) => data.moduleKey));
      const results: Array<{
        changed: boolean;
        entitlement: (typeof all)[number] | null;
      }> = [];

      for (const data of changes) {
        const current = currentByKey.get(data.moduleKey) ?? null;
        if (!changedKeys.has(data.moduleKey)) {
          results.push({ changed: false, entitlement: current });
          continue;
        }

        const revision = current ? current.revision + 1 : 1;
        const entitlement = current
          ? await tx.businessModuleEntitlement.update({
              where: { id: current.id },
              data: {
                status: data.status,
                enabledFrom: data.enabledFrom,
                enabledUntil: data.enabledUntil,
                source: data.source,
                planCode: data.planCode || null,
                revision,
                updatedById: input.actor.userId,
              },
            })
          : await tx.businessModuleEntitlement.create({
              data: {
                businessId,
                moduleKey: data.moduleKey,
                status: data.status,
                enabledFrom: data.enabledFrom,
                enabledUntil: data.enabledUntil,
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
            businessId,
            moduleKey: data.moduleKey,
            revision,
            oldStatus: current?.status ?? null,
            newStatus: data.status,
            oldEnabledFrom: current?.enabledFrom ?? null,
            newEnabledFrom: data.enabledFrom,
            oldEnabledUntil: current?.enabledUntil ?? null,
            newEnabledUntil: data.enabledUntil,
            source: data.source,
            planCode: data.planCode || null,
            reason: data.reason,
            actorUserId: input.actor.userId,
          },
        });
        await writeAuditLog(
          {
            businessId,
            actor: input.actor,
            request: input.request,
            action: "BUSINESS_MODULE_ENTITLEMENT_CHANGED",
            entityType: "BusinessModuleEntitlement",
            entityId: entitlement.id,
            summary: `${data.moduleKey} module changed to ${data.status}.`,
            before: current
              ? { status: current.status, enabledFrom: current.enabledFrom, enabledUntil: current.enabledUntil, revision: current.revision }
              : null,
            after: { status: data.status, enabledFrom: data.enabledFrom, enabledUntil: data.enabledUntil, revision, source: data.source },
            metadata: { moduleKey: data.moduleKey, reason: data.reason, planCode: data.planCode || null },
          },
          tx,
        );
        results.push({ changed: true, entitlement });
      }

      return {
        changedCount: results.filter((result) => result.changed).length,
        results,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function sameEntitlementState(
  current: {
    status: BusinessModuleEntitlementStatus;
    enabledFrom: Date;
    enabledUntil: Date | null;
    planCode: string | null;
  } | null,
  desired: {
    status: BusinessModuleEntitlementStatus;
    enabledFrom: Date;
    enabledUntil: Date | null;
    planCode?: string | null;
  },
) {
  if (!current) return desired.status === "DISABLED";
  return (
    current.status === desired.status &&
    current.enabledFrom.getTime() === desired.enabledFrom.getTime() &&
    sameTime(current.enabledUntil, desired.enabledUntil) &&
    (current.planCode ?? null) === (desired.planCode || null)
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

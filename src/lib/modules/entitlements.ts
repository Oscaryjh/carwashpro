import type { BusinessModuleEntitlement, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULE_REGISTRY, moduleKeys, type ModuleKey } from "./registry";

export const MODULE_NOT_ENABLED = "MODULE_NOT_ENABLED";

export class ModuleNotEnabledError extends Error {
  readonly code = MODULE_NOT_ENABLED;

  constructor(readonly moduleKey: ModuleKey) {
    super(`${MODULE_REGISTRY[moduleKey].label} is not enabled for this business.`);
    this.name = "ModuleNotEnabledError";
  }
}

type EntitlementReader = Pick<typeof prisma, "businessModuleEntitlement"> | Prisma.TransactionClient;

export type BusinessModuleContext = {
  businessId: string;
  evaluatedAt: Date;
  enabledModules: ReadonlySet<ModuleKey>;
  records: readonly BusinessModuleEntitlement[];
};

export async function loadBusinessModuleContext(
  businessId: string,
  options: { now?: Date; database?: EntitlementReader } = {},
): Promise<BusinessModuleContext> {
  const now = options.now ?? new Date();
  const database = options.database ?? prisma;
  const records = await database.businessModuleEntitlement.findMany({
    where: { businessId },
    orderBy: { moduleKey: "asc" },
  });
  const directlyEnabled = new Set<ModuleKey>(["CORE"]);
  for (const record of records) {
    if (
      record.status === "ENABLED" &&
      record.enabledFrom.getTime() <= now.getTime() &&
      (record.enabledUntil === null || record.enabledUntil.getTime() > now.getTime())
    ) {
      directlyEnabled.add(record.moduleKey as ModuleKey);
    }
  }

  const enabledModules = new Set<ModuleKey>(["CORE"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of moduleKeys) {
      if (enabledModules.has(key) || !directlyEnabled.has(key)) continue;
      if (MODULE_REGISTRY[key].dependencies.every((dependency) => enabledModules.has(dependency))) {
        enabledModules.add(key);
        changed = true;
      }
    }
  }

  return { businessId, evaluatedAt: now, enabledModules, records };
}

export function hasBusinessModule(context: BusinessModuleContext, moduleKey: ModuleKey) {
  return context.enabledModules.has(moduleKey);
}

export async function requireBusinessModule(
  businessId: string,
  moduleKey: ModuleKey,
  options: { now?: Date; database?: EntitlementReader } = {},
) {
  const context = await loadBusinessModuleContext(businessId, options);
  if (!hasBusinessModule(context, moduleKey)) throw new ModuleNotEnabledError(moduleKey);
  return context;
}

export async function isBusinessModuleEnabled(
  businessId: string,
  moduleKey: ModuleKey,
  options: { now?: Date; database?: EntitlementReader } = {},
) {
  return hasBusinessModule(
    await loadBusinessModuleContext(businessId, options),
    moduleKey,
  );
}

export async function requireBusinessModules(
  businessId: string,
  requiredModules: readonly ModuleKey[],
  options: { now?: Date; database?: EntitlementReader } = {},
) {
  const context = await loadBusinessModuleContext(businessId, options);
  for (const moduleKey of requiredModules) {
    if (!hasBusinessModule(context, moduleKey)) throw new ModuleNotEnabledError(moduleKey);
  }
  return context;
}

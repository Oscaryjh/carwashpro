import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveBusinessAccess, type ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { ModuleNotEnabledError, requireBusinessModules } from "@/lib/modules/entitlements";
import { modulesForCapability } from "@/lib/modules/registry";

export type OutletDatabase = Pick<typeof prisma,
  "user" | "business" | "businessGroupUser" | "businessModuleEntitlement" | "branch">;
type GrantedAccess = Extract<ResolvedBusinessAccess, { granted: true }>;
type OperationalBranch = Readonly<{ id: string; name: string }>;

// The module owns scope semantics. There is intentionally no default Owner/Staff
// scope policy here. A business-wide Expense is not a branch-scoped inventory write.
export type OutletScope =
  | { kind: "none" }
  | { kind: "business"; allowExplicitBusinessWide?: boolean }
  | { kind: "branches"; branchIds: readonly string[] };

export type OutletScopeResolver = (context: {
  businessId: string;
  access: GrantedAccess;
  capability: BusinessCapability;
  operation: "read" | "write";
  activeBranches: readonly OperationalBranch[];
  database: OutletDatabase;
}) => Promise<OutletScope>;

type BranchInput =
  | { kind: "absent" }
  | { kind: "explicit"; branchId: string }
  | { kind: "business"; value: null | string };

type AuthorizedContext = {
  businessId: string;
  authorizedScope: Exclude<OutletScope, { kind: "none" }>;
  branchInput: BranchInput;
};

export type CurrentOutletContext =
  | { kind: "denied" }
  | { kind: "no_location"; businessId: string }
  | (AuthorizedContext & { kind: "single_outlet"; internalBranchId: string; branchNameSnapshot: string })
  | (AuthorizedContext & { kind: "legacy_multi_branch"; branches: readonly OperationalBranch[] });

export type ResolveCurrentOutletInput = {
  businessId: string;
  actorUserId: string;
  capability: BusinessCapability;
  operation: "read" | "write";
  explicitBranchInput?: string | null;
  /** Trusted server-side module policy, evaluated afresh; never a cached page grant. */
  resolveScope: OutletScopeResolver;
};

/** Current operations only. Never use this result to rewrite historical document
 * branch IDs. It is not a writer authorization token: writers must still recheck
 * access/document scope inside their transaction, including on idempotency replay.
 */
export async function resolveCurrentOutletContext(
  input: ResolveCurrentOutletInput,
  database: OutletDatabase = prisma,
): Promise<CurrentOutletContext> {
  // Pin primitive request fields and the trusted policy before the first await.
  input = { ...input };
  const denied = { kind: "denied" } as const;
  if (!input.businessId || !input.actorUserId || !input.capability ||
      !["read", "write"].includes(input.operation) || typeof input.resolveScope !== "function") return denied;

  const access = await resolveBusinessAccess({
    userId: input.actorUserId, requestedBusinessId: input.businessId, capability: input.capability,
  }, database);
  if (!access.granted || access.businessId !== input.businessId || !access.industryType) return denied;
  try {
    await requireBusinessModules(input.businessId, modulesForCapability(input.capability, access.industryType), { database });
  } catch (error) {
    if (error instanceof ModuleNotEnabledError) return denied;
    throw error;
  }

  const activeBranches = await database.branch.findMany({
    where: { businessId: input.businessId, status: "ACTIVE" },
    select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const scope = await input.resolveScope({
    businessId: input.businessId, access, capability: input.capability,
    operation: input.operation, activeBranches, database,
  });
  // This adapter's current-outlet branch operations do not grant writes to a
  // read-only effective role. Existing module policies (e.g. HR) are untouched.
  if (input.operation === "write" && access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY") return denied;
  if (!scope || scope.kind === "none") return denied;
  // Validate scope output rather than silently dropping foreign/inactive IDs.
  if (scope.kind !== "business" && (scope.kind !== "branches" || !Array.isArray(scope.branchIds) ||
      !scope.branchIds.length || scope.branchIds.some(id => !activeBranches.some(branch => branch.id === id)))) return denied;
  const authorizedBranches = scope.kind === "business" ? activeBranches
    : activeBranches.filter(branch => scope.branchIds.includes(branch.id));

  let branchInput: BranchInput = { kind: "absent" };
  if (Object.prototype.hasOwnProperty.call(input, "explicitBranchInput")) {
    const value = input.explicitBranchInput;
    if (value === null || (typeof value === "string" && !value.trim())) {
      if (scope.kind !== "business" || scope.allowExplicitBusinessWide !== true) return denied;
      branchInput = { kind: "business", value };
    } else {
      if (typeof value !== "string" || !authorizedBranches.some(branch => branch.id === value)) return denied;
      branchInput = { kind: "explicit", branchId: value };
    }
  }
  if (!activeBranches.length) return { kind: "no_location", businessId: input.businessId };
  if (!authorizedBranches.length) return denied;

  const shared = { businessId: input.businessId, authorizedScope: scope, branchInput };
  if (activeBranches.length === 1) {
    const branch = authorizedBranches[0];
    return { kind: "single_outlet", ...shared, internalBranchId: branch.id, branchNameSnapshot: branch.name };
  }
  return { kind: "legacy_multi_branch", ...shared, branches: authorizedBranches };
}

import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveCurrentOutletContext, type OutletDatabase } from "@/lib/outlet-context";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";

type Access = Extract<ResolvedBusinessAccess, { granted: true }>;
type Surface = "dashboard" | "reports" | "performance";
type Selection = { kind: "branch"; branchId: string } | { kind: "authorized_branches"; branchIds: string[] } | { kind: "business" };
export type ReportOutletScope = { kind: "denied" } | { kind: "no_location" } | {
  kind: "ready";
  topologyMode: "single_outlet" | "legacy_multi_branch" | "no_location";
  access: Access;
  branches: { id: string; name: string }[];
  selection: Selection;
  historical: boolean;
  businessScopeAllowed: boolean;
  expenseScope: { allowedBranchIds: string[]; includeBusinessWide: boolean; branchId?: string };
};

/** Read-only consumer adapter. Topology comes only from outlet-context. Historical
 * access is checked separately and never rewrites the original record branch. */
export async function resolveReportOutletScope(input: {
  businessId: string; actorUserId: string; surface: Surface; explicitBranchInput?: unknown;
}, database: OutletDatabase = prisma): Promise<ReportOutletScope> {
  const denied = { kind: "denied" } as const;
  const explicit = Object.prototype.hasOwnProperty.call(input, "explicitBranchInput");
  if (explicit && typeof input.explicitBranchInput !== "string") return denied;
  const capability = input.surface === "reports" ? "VIEW_REPORTS"
    : input.surface === "performance" ? "PERFORMANCE_VIEW_TEAM" : "VIEW_DASHBOARD";
  let effective: Access | undefined;
  const context = await resolveCurrentOutletContext({ businessId: input.businessId, actorUserId: input.actorUserId,
    capability, operation: "read", resolveScope: async ({ access }) => {
      effective = access;
      if (input.surface === "performance" && access.source !== "DIRECT_BUSINESS") return { kind: "none" };
      const broad = access.effectiveBusinessRole === "BUSINESS_OWNER" || access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
        (input.surface !== "dashboard" && input.surface !== "performance" && access.permissions.includes("ALL_BRANCHES"));
      return broad ? { kind: "business" } : access.branchId ? { kind: "branches", branchIds: [access.branchId] } : { kind: "none" };
    },
  }, database);
  if (context.kind === "denied" || !effective) return denied;
  const access: Access = effective;
  const broad = context.kind === "no_location" || context.authorizedScope.kind === "business";
  const currentBranches = context.kind === "single_outlet" ? [{ id: context.internalBranchId, name: context.branchNameSnapshot }]
    : context.kind === "legacy_multi_branch" ? [...context.branches] : [];
  const historicalReader = input.surface === "performance";
  const historicalBranches = historicalReader ? await database.branch.findMany({ where: { businessId: input.businessId }, select: { id: true, name: true } }) : [];
  const branches = historicalReader ? historicalBranches.filter(b => broad || b.id === access.branchId) : currentBranches;
  let selection: Selection;
  let historical = false;
  if (explicit) {
    const id = input.explicitBranchInput as string;
    if (id === "" && input.surface === "dashboard" && context.kind === "legacy_multi_branch" && broad) {
      selection = { kind: "authorized_branches", branchIds: currentBranches.map(b => b.id) };
    } else {
      if (!branches.some(b => b.id === id)) return denied;
      selection = { kind: "branch", branchId: id };
      historical = historicalReader && !currentBranches.some(b => b.id === id);
    }
  } else if (context.kind === "single_outlet") {
    selection = { kind: "branch", branchId: context.internalBranchId };
  } else if (context.kind === "no_location") {
    return { kind: "no_location" };
  } else if (input.surface === "performance") {
    selection = access.branchId && branches.some(b => b.id === access.branchId) ? { kind: "branch", branchId: access.branchId }
      : branches.length === 1 ? { kind: "branch", branchId: branches[0].id }
        : { kind: "authorized_branches", branchIds: branches.map(b => b.id) };
  } else if (input.surface === "reports" && broad) {
    selection = { kind: "business" };
  } else {
    selection = { kind: "authorized_branches", branchIds: currentBranches.map(b => b.id) };
  }
  const branchIds = selection.kind === "branch" ? [selection.branchId] : currentBranches.map(b => b.id);
  // Auto current-outlet selection must not drop the original business-wide
  // Expense bucket. A deliberate explicit branch keeps its original semantics.
  const includeBusinessWide = broad && (selection.kind !== "branch" || !explicit);
  return { kind: "ready", topologyMode: context.kind, access, branches, selection, historical,
    businessScopeAllowed: broad,
    expenseScope: { allowedBranchIds: branchIds, includeBusinessWide,
      ...(selection.kind === "branch" && !includeBusinessWide ? { branchId: selection.branchId } : {}) },
  };
}

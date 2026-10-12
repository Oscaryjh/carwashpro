import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { resolveCurrentOutletContext } from "@/lib/outlet-context";
import { resolveReportOutletScope } from "@/lib/report-outlet-context";
import { resolveInventoryOutletReadContext } from "@/lib/outlet-ui-context";
import { resolveExpenseOutletContext } from "@/lib/expense/outlet-scope";
import { resolvePosOutletContext } from "@/lib/pos-outlet-context";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import type { CurrentOutletContext } from "@/lib/outlet-context";

export const PILOT_OWNER_NOTICE = "Ask Tetamu Pilot is currently available to Business Owners only.";
export const PILOT_GROUP_NOTICE = "Ask Tetamu Pilot currently supports individual businesses only. Open a business to continue.";
export type PilotDomain = "REPORTS" | "PAYMENTS" | "EXPENSES" | "INVENTORY" | "APPOINTMENTS";
export type PilotGrant = { domain: PilotDomain; branchIds: string[]; allBranches: boolean; includeBusinessWide: boolean };

export async function canSendOwnerPilot(userId: string, businessId: string) {
  const access = await resolveBusinessAccess({ userId, requestedBusinessId: businessId, capability: "USE_AI_ANALYSIS" });
  return access.granted && access.businessId === businessId && access.homeBusinessId === businessId &&
    access.source === "DIRECT_BUSINESS" && access.identityRole === "BUSINESS_OWNER" && access.effectiveBusinessRole === "BUSINESS_OWNER";
}

/** Each domain keeps its own canonical scope adapter and module/capability check.
 * This is not a replacement for a module's authorization policy. */
export async function resolvePilotReadGrants(input: { userId: string; businessId: string; explicitBranchInput?: string | null }) {
  const explicit = Object.hasOwn(input, "explicitBranchInput");
  const branchInput = explicit ? { explicitBranchInput: input.explicitBranchInput } : {};
  const access = await resolveBusinessAccess({ userId: input.userId, requestedBusinessId: input.businessId, capability: "VIEW_AI_ANALYSIS" });
  if (!access.granted || access.businessId !== input.businessId || !(await isBusinessModuleEnabled(input.businessId, "AI"))) throw new Error("AI_SCOPE_DENIED");
  // Even when a data domain is disabled, an explicit invalid branch must not
  // disappear into an omitted-source fallback.
  if (explicit) {
    if (typeof input.explicitBranchInput !== "string" || !input.explicitBranchInput.trim()) throw new Error("AI_SCOPE_DENIED");
    const branch = await resolveCurrentOutletContext({ businessId: input.businessId, actorUserId: input.userId,
      capability: "VIEW_AI_ANALYSIS", operation: "read", ...branchInput,
      resolveScope: async () => ({ kind: "business" }),
    });
    if (branch.kind === "denied" || branch.kind === "no_location") throw new Error("AI_SCOPE_DENIED");
  }
  const args = { businessId: input.businessId, actorUserId: input.userId, ...branchInput };
  const [report, inventory, expense, appointments] = await Promise.all([
    (await isBusinessModuleEnabled(input.businessId, "POS")) ? resolveReportOutletScope({ ...args, surface: "reports" }) : null,
    resolveInventoryOutletReadContext(args),
    resolveExpenseOutletContext({ ...args, capability: "VIEW_EXPENSE", operation: "read" }),
    resolvePosOutletContext({ ...args, capability: "VIEW_APPOINTMENTS", operation: "read" }),
  ]);
  const grants: PilotGrant[] = [];
  if (report?.kind === "ready") {
    const scope = { branchIds: report.selection.kind === "branch" ? [report.selection.branchId] : report.selection.kind === "authorized_branches" ? report.selection.branchIds : report.branches.map(b => b.id), allBranches: report.selection.kind === "business", includeBusinessWide: report.selection.kind === "business" };
    grants.push({ domain: "REPORTS", ...scope }, { domain: "PAYMENTS", ...scope });
  }
  const stock = operationalGrant(inventory);
  if (stock) grants.push({ domain: "INVENTORY", ...stock });
  const spending = operationalGrant(expense.context);
  if (spending) grants.push({ domain: "EXPENSES", ...spending, includeBusinessWide: expense.businessWideAllowed && !explicit });
  const bookings = operationalGrant(appointments);
  if (bookings) grants.push({ domain: "APPOINTMENTS", ...bookings });
  const business = await prisma.business.findUniqueOrThrow({ where: { id: input.businessId }, select: { id: true, name: true, timezone: true, businessDayCutoffTime: true } });
  // Keep source drill-down links scoped to the explicitly validated Branch.
  const selectedBranch = explicit ? await prisma.branch.findFirstOrThrow({
    where: { id: input.explicitBranchInput!, businessId: input.businessId, status: "ACTIVE" },
    select: { id: true, name: true },
  }) : null;
  return { business, grants, selectedBranch };
}

function operationalGrant(context: CurrentOutletContext) {
  if (context.kind === "denied" || context.kind === "no_location") return null;
  const branchIds = context.branchInput.kind === "explicit" ? [context.branchInput.branchId]
    : context.kind === "single_outlet" ? [context.internalBranchId] : context.branches.map(b => b.id);
  return { branchIds, allBranches: false, includeBusinessWide: false };
}

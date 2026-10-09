import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getActiveBranches } from '@/lib/branches';
import { hasBusinessCapability, resolveBusinessAccess, type ResolvedBusinessAccess } from '@/lib/business-groups/business-access';
import type { BusinessCapability } from '@/lib/business-groups/capabilities';

export type InventoryReadScope =
  | { kind: 'business' }
  | { kind: 'branches'; branchIds: string[] }
  | { kind: 'none' };

export async function getInventoryReadBranches(businessId: string, access: ResolvedBusinessAccess) {
  if (!access.granted || access.businessId !== businessId || !hasBusinessCapability(access, 'VIEW_INVENTORY')) return [];
  const branches = await getActiveBranches(businessId);
  if (access.effectiveBusinessRole === 'BUSINESS_OWNER' || access.effectiveBusinessRole === 'GROUP_MANAGER_READ_ONLY') return branches;
  return branches.filter(branch => branch.id === access.branchId);
}

export async function resolveInventoryReadScope(businessId: string, access: ResolvedBusinessAccess, requestedBranchId?: string): Promise<InventoryReadScope> {
  const branches = await getInventoryReadBranches(businessId, access);
  if (requestedBranchId) {
    if (!branches.some(branch => branch.id === requestedBranchId)) throw new Error('Inventory branch is outside your authorised scope.');
    return { kind: 'branches', branchIds: [requestedBranchId] };
  }
  if (!access.granted || access.businessId !== businessId || !hasBusinessCapability(access, 'VIEW_INVENTORY')) return { kind: 'none' };
  if (access.effectiveBusinessRole === 'BUSINESS_OWNER' || access.effectiveBusinessRole === 'GROUP_MANAGER_READ_ONLY') return { kind: 'business' };
  return branches.length ? { kind: 'branches', branchIds: branches.map(branch => branch.id) } : { kind: 'none' };
}

// Resolve fresh effective access inside the writer transaction, before replay.
// A caller-provided branch or cached page access is not authorization evidence.
export async function assertInventoryBranchWrite(db: Prisma.TransactionClient, businessId: string, userId: string, capability: BusinessCapability, branchId: string, requireActive = true) {
  const access = await resolveBusinessAccess({ userId, requestedBusinessId: businessId, capability }, db);
  if (!access.granted || access.businessId !== businessId || access.effectiveBusinessRole === 'GROUP_MANAGER_READ_ONLY' || access.effectiveBusinessRole === 'PLATFORM_ADMIN') throw new Error('Inventory document is outside your authorised scope.');
  const branch = await db.branch.findFirst({ where: { businessId, id: branchId, ...(requireActive ? { status: 'ACTIVE' as const } : {}) }, select: { id: true } });
  if (!branch || (access.effectiveBusinessRole !== 'BUSINESS_OWNER' && access.branchId !== branch.id)) throw new Error('Inventory document is outside your authorised branch scope.');
}

export async function assertInventoryDocumentWrite(db: Prisma.TransactionClient, businessId: string, userId: string, capability: BusinessCapability, kind: 'purchaseOrder' | 'stockCount' | 'receiptLine', id: string) {
  const document = kind === 'purchaseOrder'
    ? await db.purchaseOrder.findFirst({ where: { businessId, id }, select: { branchId: true } })
    : kind === 'stockCount'
      ? await db.stockCountSession.findFirst({ where: { businessId, id }, select: { branchId: true } })
      : await db.goodsReceiptLine.findFirst({ where: { businessId, id }, select: { goodsReceipt: { select: { branchId: true } } } });
  if (!document) throw new Error('Inventory document is outside your authorised scope.');
  const branchId = 'branchId' in document ? document.branchId : document.goodsReceipt.branchId;
  // Existing-document authorization must not add a new lifecycle restriction.
  // Create/receive retain their own active-branch rules; inactive Staff scope
  // is already denied by the effective access resolver.
  await assertInventoryBranchWrite(db, businessId, userId, capability, branchId, false);
}

export async function authorizeInventoryDocument(businessId: string, userId: string, capability: BusinessCapability, kind: 'purchaseOrder' | 'stockCount' | 'receiptLine', id: string) {
  await assertInventoryDocumentWrite(prisma, businessId, userId, capability, kind, id);
}

// Real action / authorization / reader regression tests; external writes are intercepted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { canDirectStaff, canGroupManager, type BusinessCapability } from '../../src/lib/business-groups/capabilities';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const key = '__inventoryAuthorizationAudit';
type Bag = Record<string, unknown>;
type Query = { where: Bag };

test('Inventory authorization regression (no database connection or writes)', async (t) => {
  const cache = join(process.cwd(), 'node_modules/.cache');
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, 'inventory-auth-audit-'));
  const calls: Array<{ name: string; input: Bag }> = [];
  const queries: Bag[] = [];
  const user = { userId: 'actor-a', role: 'STAFF', branchId: A as string | null, permissions: ['INVENTORY_VIEW', 'INVENTORY_TRANSFER', 'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_ORDERS_CANCEL', 'PURCHASE_ORDERS_RECEIVE', 'GOODS_RECEIPTS_REVERSE', 'STOCK_COUNTS_VIEW', 'STOCK_COUNTS_COUNT', 'STOCK_COUNTS_APPROVE', 'STOCK_COUNTS_CANCEL'], name: 'Audit actor', email: 'audit@example.test' };
  const branches = [{ id: A, name: 'A' }, { id: B, name: 'B' }];
  const document = { id: D, businessId: 'business', branchId: B };
  const db = {
    user: { findUnique: async () => ({ ...user, id: user.userId, businessId: 'business', status: 'active', loginEnabled: true, business: { id: 'business', status: 'active', industryType: 'SALON_BEAUTY' }, branch: user.branchId ? { id: user.branchId, businessId: 'business', status: 'ACTIVE' } : null }) },
    branch: { findMany: async () => branches, findFirst: async ({ where }: Query) => branches.find(b => b.id === where.id) ?? null },
    stockCountSession: { findFirst: async () => document },
    purchaseOrder: { findFirst: async ({ where }: Query) => { const scope = where.branchId as { in?: string[] } | undefined; return scope?.in && !scope.in.includes(B) ? null : document; } },
    productStock: { findMany: async ({ where }: Query) => { queries.push(where); return []; } },
    inventoryMovement: { findMany: async () => [], groupBy: async () => [] },
    invoiceItem: { findMany: async () => [] }, goodsReceiptLine: { findMany: async () => [], findFirst: async () => ({ goodsReceipt: { branchId: document.branchId } }) },
    goodsReceiptReversal: { findMany: async () => [] }, purchaseOrderLine: { findMany: async () => [] }, stockCountLine: { findMany: async () => [] },
  };
  const state = { user, db, tx: {} as Bag, context: (capability: BusinessCapability) => { assert.equal(user.role === 'BUSINESS_OWNER' || canDirectStaff(user.permissions, capability), true, 'fixture must hold real action capability'); return { businessId: 'business', user, access: { granted: true, businessId: 'business', source: 'DIRECT_BUSINESS', identityRole: user.role, effectiveBusinessRole: user.role, branchId: user.branchId, permissions: user.permissions } }; }, call: (name: string, input: Bag) => { calls.push({ name, input }); return { id: D, receiptNumber: 'AUDIT-GRN' }; } };
  const globalBag = globalThis as unknown as Record<string, unknown>;
  globalBag[key] = state;
  const ref = `globalThis[${JSON.stringify(key)}]`;
  let serial = 0;
  async function load(entry: string, realService = false) {
    const outfile = join(dir, `${serial++}.cjs`);
    await build({ entryPoints: [entry], outfile, bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'silent',
      plugins: [{ name: 'memory-only-boundaries', setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/(?:auth\/business-user|prisma|audit|modules\/entitlements|inventory\/(?:service|purchasing-service|stock-count-service|supplier-ap-service))|next\/(?:navigation|cache|link))$/ }, args => {
          if (realService && args.path.startsWith('@/lib/inventory/') && args.path !== '@/lib/inventory/service') return;
          return { path: args.path, namespace: 'audit' };
        });
        b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'css' }));
        b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}' }));
        b.onLoad({ filter: /.*/, namespace: 'audit' }, args => {
          let contents = '';
          if (args.path.endsWith('/prisma')) contents = `export const prisma=${ref}.db;`;
          else if (args.path.endsWith('/business-user')) contents = `export async function requireBusinessUserForModule(module,capability){return ${ref}.context(capability)}`;
          else if (args.path === 'next/navigation') contents = `export function redirect(url){throw Error('REDIRECT:'+url)};export function notFound(){throw Error('NOT_FOUND')}`;
          else if (args.path === 'next/cache') contents = 'export function revalidatePath(){}';
          else if (args.path === 'next/link') contents = 'export default function Link(){return null}';
          else if (args.path.endsWith('/audit')) contents = 'export async function writeAuditLog(){}';
          else if (args.path.endsWith('/entitlements')) contents = 'export async function isBusinessModuleEnabled(){return true}';
          else if (realService && args.path.endsWith('/service')) contents = `export async function runInventorySerializable(fn){return fn(${ref}.tx)};export class InventoryConflictError extends Error{};export async function applyInventoryMovement(){throw Error('UNEXPECTED_WRITE')}`;
          else contents = ['runManualInventoryMovement','transferInventory','createStockCount','approveStockCount','cancelStockCount','recordStockCountLine','reopenStockCount','setReorderSettings','startStockCount','submitStockCount','createSupplier','updateSupplier','createPurchaseOrder','updatePurchaseOrder','approvePurchaseOrder','cancelPurchaseOrder','closePurchaseOrder','receivePurchaseOrder','reverseGoodsReceiptLine','purchaseOrderTrace','reconcileInventory'].map(name => `export async function ${name}(input,branch){return ${ref}.call('${name}',{...input,branch})}`).join(';') + ';export const mapStockCountError=e=>e.message,mapPurchasingError=e=>e.message;';
          return { contents };
        });
      } }],
    });
    return createRequire(import.meta.url)(outfile);
  }
  const form = (extra: Bag = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ operationKey: 'inventory-audit-operation-key', expectedRevision: 0, purchaseOrderId: D, sessionId: D, lineId: D, goodsReceiptLineId: D, expectedLineRevision: 0, actualQuantity: 8, quantity: 1, reason: 'Controlled audit', lines: JSON.stringify([{ purchaseOrderLineId: D, quantity: 1 }]), ...extra })) f.set(k, String(v));
    return f;
  };
  try {
    const branch = await load('src/lib/branches.ts');
    await t.test('Effective GM scope is identical for both identity roles; invalid explicit branch fails closed', async () => {
      const auth = await load('src/lib/inventory/authorization.ts');
      for (const identityRole of ['STAFF', 'BUSINESS_OWNER']) {
        const access = { granted: true, businessId: 'business', source: 'GROUP_ACCESS', actorRole: 'GROUP_MANAGER', identityRole, effectiveBusinessRole: 'GROUP_MANAGER_READ_ONLY', branchId: null, permissions: [] };
        assert.deepEqual((await auth.getInventoryReadBranches('business', access)).map((b: { id: string }) => b.id), [A, B]);
        assert.deepEqual(await auth.resolveInventoryReadScope('business', access), { kind: 'business' });
        await assert.rejects(auth.resolveInventoryReadScope('business', access, D), /outside/);
      }
    });
    await t.test('Real group access resolver grants selected Business inventory read with null branch', async () => {
      const access = await load('src/lib/business-groups/business-access.ts');
      for (const identityRole of ['STAFF', 'BUSINESS_OWNER']) {
        const database = {
          user: { findUnique: async () => ({ id: 'gm', role: identityRole, status: 'active', loginEnabled: true, businessId: 'home', branchId: A, permissions: [], business: { id: 'home', status: 'active' } }) },
          business: { findUnique: async () => ({ id: 'business', status: 'active', industryType: 'SALON_BEAUTY' }) },
          businessGroupUser: { findFirst: async () => ({ id: 'grant', groupId: 'group', role: 'GROUP_MANAGER', status: 'ACTIVE', accessScope: 'SELECTED_BUSINESSES', businessAccesses: [{ businessId: 'business' }] }) },
        };
        const result = await access.resolveBusinessAccess({ userId: 'gm', requestedBusinessId: 'business', capability: 'VIEW_INVENTORY' }, database);
        assert.equal(result.granted, true);
        assert.equal(result.effectiveBusinessRole, 'GROUP_MANAGER_READ_ONLY');
        assert.equal(result.branchId, null);
        assert.equal(access.hasBusinessCapability(result, 'VIEW_INVENTORY'), true);
        assert.equal(access.hasBusinessCapability(result, 'MANAGE_INVENTORY'), false);
        // tenant.ts retains the identity role for GROUP_MANAGER_READ_ONLY.
        assert.equal((await branch.getOperationalBranches('business', { role: identityRole, branchId: result.branchId })).length, identityRole === 'STAFF' ? 0 : 2);
      }
    });
    await t.test('Branch A stock scope excludes B; GM identity determines empty versus all active branches', async () => {
      assert.deepEqual((await branch.getOperationalBranches('business', user)).map((b: { id: string }) => b.id), [A]);
      assert.equal(canGroupManager('VIEW_INVENTORY'), true);
      assert.deepEqual(await branch.getOperationalBranches('business', { role: 'STAFF', branchId: null }), []);
      assert.equal((await branch.getOperationalBranches('business', { role: 'BUSINESS_OWNER', branchId: null })).length, 2);
      assert.equal(await branch.resolveOperationalBranchId('business', user, B), A);
    });
    const purchasing = await load('src/app/(business)/inventory/purchasing-actions.ts');
    await t.test('Branch A actor cannot update Branch B draft PO', async () => {
      user.permissions.push('PURCHASE_ORDERS_CREATE');
      calls.length = 0;
      await assert.rejects(purchasing.updatePurchaseOrderAction(form({ supplierId: D, orderDate: '2026-10-09', lines: JSON.stringify([{ productId: D, orderedQuantity: 1, expectedUnitCost: 10 }]) })), /type=error/);
      assert.equal(calls.length, 0, 'SECURITY: cross-branch draft update must be denied');
    });
    for (const name of ['approvePurchaseOrderAction', 'cancelPurchaseOrderAction', 'closePurchaseOrderAction', 'receivePurchaseOrderAction', 'reverseGoodsReceiptLineAction']) {
      await t.test(`Cross-branch document denied before ${name} writer boundary`, async () => {
        calls.length = 0;
        await assert.rejects(purchasing[name](form()), /type=error/);
        assert.equal(calls.length, 0, 'SECURITY: cross-branch writer must not be reached');
      });
    }
    const counts = await load('src/app/(business)/inventory/stock-count-actions.ts');
    for (const name of ['startStockCountAction','submitStockCountAction','recordStockCountLineAction','approveStockCountAction','reopenStockCountAction','cancelStockCountAction']) {
      await t.test(`Cross-branch count denied before ${name} writer boundary`, async () => {
        calls.length = 0;
        await assert.rejects(counts[name](form()), /type=error/);
        assert.equal(calls.length, 0, 'SECURITY: cross-branch writer must not be reached');
      });
    }
    await t.test('Same-branch Staff and Owner across branches still reach all authorized action writers', async () => {
      for (const role of ['STAFF', 'BUSINESS_OWNER']) {
        user.role = role; document.branchId = role === 'STAFF' ? A : B;
        for (const [actions, names] of [[purchasing, ['approvePurchaseOrderAction','cancelPurchaseOrderAction','closePurchaseOrderAction','receivePurchaseOrderAction','reverseGoodsReceiptLineAction']], [counts, ['startStockCountAction','submitStockCountAction','recordStockCountLineAction','approveStockCountAction','reopenStockCountAction','cancelStockCountAction']]] as const) {
          for (const name of names) { calls.length = 0; await assert.rejects(actions[name](form()), /type=success/); assert.equal(calls.length, 1, name); }
        }
        calls.length = 0;
        await assert.rejects(purchasing.updatePurchaseOrderAction(form({ supplierId: D, orderDate: '2026-10-09', lines: JSON.stringify([{ productId: D, orderedQuantity: 1, expectedUnitCost: 10 }]) })), /type=success/);
        assert.equal(calls.length, 1);
      }
      user.role = 'STAFF'; document.branchId = B;
    });
    await t.test('B stock-count detail is denied for A actor', async () => {
      const page = await load('src/app/(business)/inventory/stock-counts/[sessionId]/page.tsx');
      await assert.rejects(page.default({ params: Promise.resolve({ sessionId: D }), searchParams: Promise.resolve({}) }), /NOT_FOUND/);
    });
    await t.test('B PO detail is denied for A actor', async () => {
      const page = await load('src/app/(business)/inventory/purchase-orders/[purchaseOrderId]/page.tsx');
      await assert.rejects(page.default({ params: Promise.resolve({ purchaseOrderId: D }), searchParams: Promise.resolve({}) }), /NOT_FOUND/);
    });
    await t.test('No-branch reconciliation page passes explicit empty scope', async () => {
      user.branchId = null; calls.length = 0;
      const page = await load('src/app/(business)/inventory/reconciliation/page.tsx');
      // Reader stub lacks the render DTO; inspect the actual authorized argument.
      await assert.rejects(page.default({ searchParams: Promise.resolve({}) }), TypeError);
      assert.deepEqual(calls.find(c => c.name === 'reconcileInventory')?.input.branch, { kind: 'none' });
      user.branchId = A;
    });
    await t.test('Reconciliation reader rejects null and preserves none/branch/business scopes', async () => {
      const service = await load('src/lib/inventory/service.ts');
      queries.length = 0;
      await assert.rejects(service.reconcileInventory('business', null), /Explicit inventory read scope/);
      await service.reconcileInventory('business', { kind: 'none' });
      assert.equal(queries[0].businessId, 'business');
      assert.deepEqual(queries[0].branchId, { in: [] });
      await service.reconcileInventory('business', { kind: 'branches', branchIds: [A] });
      assert.deepEqual(queries[1].branchId, { in: [A] });
      await service.reconcileInventory('business', { kind: 'business' });
      assert.equal(Object.hasOwn(queries[2], 'branchId'), false);
    });
    await t.test('Staff transfer is denied despite capability; no writer reached', async () => {
      assert.equal(canDirectStaff(['INVENTORY_TRANSFER'], 'TRANSFER_INVENTORY'), true);
      const actions = await load('src/app/(business)/inventory/actions.ts');
      calls.length = 0;
      await assert.rejects(actions.transferInventoryAction(form({ sourceBranchId: A, destinationBranchId: B, productId: D })), /type=error/);
      assert.equal(calls.length, 0);
    });
    await t.test('Real PO service rejects self-approval, including an Owner actor', async () => {
      user.role = 'BUSINESS_OWNER';
      state.tx = { ...db, inventoryPurchasingCommand: { findUnique: async () => null }, purchaseOrder: { ...db.purchaseOrder, findFirstOrThrow: async () => ({ ...document, status: 'DRAFT', createdById: user.userId }) } };
      const service = await load('src/lib/inventory/purchasing-service.ts', true);
      await assert.rejects(service.approvePurchaseOrder({ businessId: 'business', purchaseOrderId: D, actor: { userId: user.userId }, expectedRevision: 0, operationKey: 'audit-self-approval-key' }), /creator cannot approve their own/);
    });
    await t.test('Real count service rejects counter approving own variance', async () => {
      state.tx = { ...db, stockCountCommand: { findUnique: async () => null }, stockCountSession: { ...db.stockCountSession, findFirstOrThrow: async () => ({ ...document, status: 'SUBMITTED', revision: 0, lines: [{ actualQuantity: 8, expectedQuantityAtCount: 10, varianceQuantity: -2, countedAt: new Date(), countedById: user.userId }] }) } };
      const service = await load('src/lib/inventory/stock-count-service.ts', true);
      await assert.rejects(service.approveStockCount({ businessId: 'business', sessionId: D, actor: { userId: user.userId }, expectedRevision: 0, operationKey: 'audit-self-approval-key', reason: 'Audit variance' }), /counter cannot approve their own variance/);
    });
    await t.test('Create-only count permission does not imply detail view; GM cannot write inventory', () => {
      assert.equal(canDirectStaff(['STOCK_COUNTS_CREATE'], 'CREATE_STOCK_COUNT'), true);
      assert.equal(canDirectStaff(['STOCK_COUNTS_CREATE'], 'VIEW_STOCK_COUNTS'), false);
      for (const capability of ['MANAGE_INVENTORY','CREATE_PURCHASE_ORDER','COUNT_INVENTORY','TRANSFER_INVENTORY'] as const) assert.equal(canGroupManager(capability), false);
    });
  } finally {
    delete globalBag[key];
    await rm(dir, { recursive: true, force: true });
  }
});

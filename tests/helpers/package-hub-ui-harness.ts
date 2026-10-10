import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ReactElement } from "react";
import type { PackageHubProps } from "../../src/components/packages/package-hub";
import type * as Presentation from "../../src/lib/packages/hub-presentation";
const require = createRequire(import.meta.url);
export const businessId = "11111111-1111-4111-8111-111111111111", branchId = "22222222-2222-4222-8222-222222222222";
export const event = { activityId: "a1", occurredAt: new Date("2026-10-07T02:00:00Z"), eventType: "USED" as const,
  customerPackageId: "cp1", packageId: "p1", packageName: "Haircut bundle", customerId: "c1", customerName: "Alice",
  serviceId: null, serviceName: null, usesChanged: -2, remainingBefore: 7, remainingAfter: 5, requestedUses: null,
  statusBefore: "ACTIVE" as const, statusAfter: "ACTIVE" as const, serviceChanges: [], branchId, branchName: "Local",
  actorUserId: "u1", actorName: "Owner", assignedStaffId: null, assignedStaffName: null, invoiceId: "i1", invoiceItemId: null,
  paymentId: "pay1", paymentRefundId: null, originalUseActivityId: null, additionalSourceRefs: null, reason: null,
  historyMayBeIncomplete: true, purchasePrice: "119.00", initialTotalUses: 10, status: "ACTIVE" as const, remainingUses: 5 };
export const fixture = {
  overview: { current: { activePackages: 7, usesLeft: 27, currentlyUsedUp: 2 }, period: { packagesSold: 13, packageUses: 29, restoredUses: 3 }, fromDate: new Date("2026-10-01Z"), toDateExclusive: new Date("2026-11-01Z") },
  activity: { rows: [event], pageSize: 20 as const, nextCursor: "next-real-cursor" },
  sales: { rows: [{ ...event, eventType: "PURCHASED" as const, usesChanged: 10, remainingBefore: 0, remainingAfter: 10 }], pageSize: 20 as const, nextCursor: null },
  customers: { rows: [{ customerPackageId: "cp1", customerId: "c1", customerName: "Alice", packageId: "p1", packageName: "Haircut bundle", remainingUses: 5, totalUses: 10, status: "ACTIVE" as const, purchasedAt: event.occurredAt, branchId, branchName: "Local", serviceBalances: [{ balanceId: "b1", serviceId: "s1", serviceName: "Haircut", remainingUses: 3, totalUses: 4 }], lastActivityAt: event.occurredAt, historyMayBeIncomplete: true }], pageSize: 20 as const, nextCursor: null },
};
export async function packageHubHarness() {
  const state = { extraHistoricalBranch: false, outletKind: "legacy_multi_branch", role: "BUSINESS_OWNER", enabled: true, manage: true, links: true, empty: false, error: undefined as Error | undefined,
    calls: [] as { reader: string; ctx: Record<string, unknown>; input: Record<string, unknown> }[] };
  const globals = globalThis as typeof globalThis & { __packageUI?: { state: typeof state; fixture: typeof fixture } };
  globals.__packageUI = { state, fixture };
  const stubs: Record<string, string> = {
    "@/lib/catalog-outlet-context": `export async function resolveCatalogOutletContext(){const kind=globalThis.__packageUI.state.outletKind;return {kind,businessId:'${businessId}',internalBranchId:'${branchId}'}}`,
    "@/lib/outlet-ui-context": "export const outletPresentation=c=>c;",
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children)",
    "next/navigation": "export function notFound(){throw Error('NOT_FOUND')}",
    "@/lib/tenant": `export async function getBusinessContext(){const s=globalThis.__packageUI.state;return{businessId:'${businessId}',isPlatformAdmin:s.role==='PLATFORM_ADMIN',user:{userId:'u1'},access:{granted:true,effectiveBusinessRole:s.role}}}`,
    "@/lib/prisma": `export const prisma={business:{findUniqueOrThrow:async()=>({timezone:'Asia/Singapore',businessDayCutoffTime:'02:00'})},branch:{findMany:async()=>[{id:'${branchId}',name:'Local'},...(globalThis.__packageUI.state.extraHistoricalBranch?[{id:'old',name:'Historical'}]:[])]},invoice:{findMany:async()=>[{id:'i1'}]}}`,
    "@/lib/business-groups/business-access": "export const hasBusinessCapability=(_,c)=>c==='VIEW_CATALOG'?globalThis.__packageUI.state.manage:globalThis.__packageUI.state.links",
    "@/lib/branches": "export const authorizedOperationalBranchWhere=()=>({})",
    "@/lib/packages/hub-scope": `export async function resolvePackageHubScope(ctx){const s=globalThis.__packageUI.state;if(!s.enabled||s.role!=='BUSINESS_OWNER')throw Error('Package Hub access denied.');if(ctx.branchId&&ctx.branchId!=='${branchId}')throw Error('Package Hub branch unavailable.');return ctx}`,
    "@/lib/packages/hub-read-model": `async function read(reader,ctx,input){const s=globalThis.__packageUI.state;s.calls.push({reader,ctx,input});if(s.error)throw s.error;return s.empty&&reader!=='overview'?{rows:[],pageSize:20,nextCursor:null}:globalThis.__packageUI.fixture[reader]};export const readPackageHubOverview=(...a)=>read('overview',...a);export const readPackageHubActivity=(...a)=>read('activity',...a);export const readPackageHubSales=(...a)=>read('sales',...a);export const readPackageHubCustomerPackages=(...a)=>read('customers',...a);`,
  };
  const result = await build({ stdin: { contents: 'export{default as Page}from"./src/app/(business)/package-hub/page";export{PackageHub}from"./src/components/packages/package-hub";export*from"./src/lib/packages/hub-presentation";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "package-ui-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "ts", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,k)=>k})", loader: "js" }));
  } }] });
  const compiled = { exports: {} }; new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiled, compiled.exports);
  return { state, api: compiled.exports as typeof Presentation & { Page: (p: { searchParams: Promise<Record<string, string | string[]>> }) => Promise<ReactElement<PackageHubProps>>; PackageHub: (p: PackageHubProps) => ReactElement }, close: () => { delete globals.__packageUI; } };
}

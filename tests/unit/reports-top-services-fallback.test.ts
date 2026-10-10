import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";

const owner: ResolvedBusinessAccess = {
  granted: true, businessId: "business", userId: "user", homeBusinessId: "business", branchId: "branch",
  identityRole: "BUSINESS_OWNER", actorRole: "BUSINESS_OWNER", effectiveBusinessRole: "BUSINESS_OWNER",
  permissions: [], industryType: "SALON_BEAUTY", source: "DIRECT_BUSINESS", groupId: null,
  groupUserId: null, capability: "VIEW_REPORTS",
};
const state: {
  access: ResolvedBusinessAccess;
  user: { role: string; permissions: string[]; branchId: string };
  industry: string;
  services: boolean;
  reads: { appointmentGroups: number; linkedInvoices: number; staffLookups: number; canonicalItems: number };
} = {
  access: owner,
  user: { role: "BUSINESS_OWNER", permissions: [] as string[], branchId: "branch" },
  industry: "SALON_BEAUTY",
  services: true,
  reads: { appointmentGroups: 0, linkedInvoices: 0, staffLookups: 0, canonicalItems: 0 },
};
const aggregate = async () => ({ _count: 0, _sum: { amount: 0, packageUses: 0, packageUsesRestored: 0, taxAmount: 0 } });
const emptyRows = async () => [];
const database = {
  business: { findUnique: async () => ({ id: "business", name: "Local Salon", timezone: "Asia/Singapore", businessDayCutoffTime: "02:00", industryType: state.industry }) },
  branch: { findMany: async () => [{ id: "branch", businessId: "business", name: "Local branch", status: "ACTIVE" }, { id: "other-branch", businessId: "business", name: "Other branch", status: "ACTIVE" }] },
  payment: { aggregate, findMany: emptyRows }, paymentRefund: { aggregate, findMany: emptyRows },
  workOrder: { groupBy: emptyRows }, invoice: { groupBy: emptyRows, aggregate, findMany: async (args: { select?: Record<string, unknown> }) => {
    if (args.select?.items) state.reads.linkedInvoices++;
    return [];
  } },
  creditNote: { aggregate }, customer: { findMany: emptyRows }, appointment: { groupBy: async () => { state.reads.appointmentGroups++; return []; } },
  user: { findMany: async () => { state.reads.staffLookups++; return []; } },
  workOrderItem: { groupBy: async () => [{ name: "Non-Salon service", _sum: { quantity: 3, lineTotal: 60 } }] },
  invoiceItem: { groupBy: async () => { state.reads.canonicalItems++; return state.services ? [{ kind: "SERVICE", serviceId: "service", name: "Historical name", _sum: { quantity: 25, lineTotal: 6250 } }] : []; } },
  service: { findMany: async () => [{ id: "service", name: "Balayage Highlights" }] },
};
const globals = globalThis as typeof globalThis & { __reportsFallback?: { state: typeof state; database: typeof database } };
let page: (props: { searchParams: Promise<{ range: string; branchId?: string }> }) => Promise<ReactElement>;
before(async () => {
  globals.__reportsFallback = { state, database };
  // Real page, capability checks, Staff guard and canonical reader. Only
  // authenticated context, database I/O and unrelated financial I/O are doubles.
  const stubs: Record<string, string> = {
    "@/lib/prisma": `export const prisma=globalThis.__reportsFallback.database;`,
    "@/lib/report-outlet-context": `export async function resolveReportOutletScope(input){const s=globalThis.__reportsFallback.state;const a=s.access;const explicit=Object.hasOwn(input,'explicitBranchInput');if(!a.granted||(explicit&&input.explicitBranchInput!=='branch'))return {kind:'denied'};const broad=a.effectiveBusinessRole==='BUSINESS_OWNER'||a.effectiveBusinessRole==='GROUP_MANAGER_READ_ONLY'||a.permissions.includes('ALL_BRANCHES');return {kind:'ready',topologyMode:'legacy_multi_branch',access:a,branches:[{id:'branch',name:'Branch'}],selection:explicit||!broad?{kind:'branch',branchId:'branch'}:{kind:'business'},businessScopeAllowed:broad,expenseScope:{allowedBranchIds:['branch'],includeBusinessWide:broad&&!explicit}}}`,
    "@/lib/tenant": `export const requireBusinessContext=async()=>{const s=globalThis.__reportsFallback.state;return {businessId:'business',industryType:s.industry,access:s.access,user:s.user}};`,
    "next/navigation": `export function redirect(){throw Error('REDIRECT')};export function notFound(){throw Error('NOT_FOUND')};export function useRouter(){throw Error('unexpected drawer navigation')};`,
    "next/link": `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)};`,
    "@/lib/branches": `export const getActiveBranches=async()=>globalThis.__reportsFallback.database.branch.findMany();export const branchWhere=id=>id?{branchId:id}:{};`,
    "@/lib/modules/entitlements": `export const loadBusinessModuleContext=async()=>({enabledModules:new Set(['POS','EXPENSE'])});`,
    "@/lib/expense/service": `export const getExpenseDashboard=async()=>({recorded:'20.00',oneOff:'20.00',recurring:'0.00',paymentsInPeriod:'10.00',paid:'10.00',unpaid:'10.00'});`,
    "@/lib/reports/daily-sales": `export {resolveReportBranchScope} from './src/lib/reports/daily-sales';export const getDailySalesReport=async()=>({summary:{netSalesCents:10000,transactionCount:2,averageSaleCents:5000,refundsCents:500,discountsCents:100,netCollectionsCents:9500},days:[],paymentMethods:[{label:'Cash',paymentCount:2,grossCents:10000,refundCents:500,netCents:9500,sharePercent:100}]});`,
  };
  const result = await build({ entryPoints: ["src/app/(business)/reports/page.tsx"], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "reports-read-boundaries", setup(builder) {
      builder.onResolve({ filter: /\.module\.css$/ }, args => ({ path: args.path, namespace: "styles" }));
      builder.onLoad({ filter: /.*/, namespace: "styles" }, () => ({ contents: "export default {};" }));
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "io" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "io" }, args => ({ contents: stubs[args.path], resolveDir: process.cwd() }));
    } }] });
  const compiled = { exports: {} as { default: typeof page } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  page = compiled.exports.default;
});
after(() => { delete globals.__reportsFallback; });

async function render(access = owner, industry = "SALON_BEAUTY", userPermissions?: string[], branchId?: string) {
  state.access = access;
  state.industry = industry;
  state.services = true;
  state.reads = { appointmentGroups: 0, linkedInvoices: 0, staffLookups: 0, canonicalItems: 0 };
  state.user = { role: access.granted ? access.identityRole : "STAFF", permissions: userPermissions ?? (access.granted ? access.permissions : []), branchId: "branch" };
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve({ range: "month", branchId }) }));
}
const staff = (permissions: string[]): ResolvedBusinessAccess => ({ ...owner, identityRole: "STAFF", actorRole: "STAFF", effectiveBusinessRole: "STAFF", permissions });
test("Reports-only explicit own branch retains canonical fallback and valid financial results", async () => {
  const implicit = await render(staff(["REPORTS"]));
  const explicit = await render(staff(["REPORTS"]), "SALON_BEAUTY", undefined, "branch");
  assert.equal(explicit, implicit);
  assert.match(explicit, /Top Services/);
  assert.match(explicit, /Balayage Highlights/);
  assert.match(explicit, /RM6,250\.00/);
});
for (const branchId of ["nonexistent", "other-branch", "cross-business", "", "   "]) {
  test(`Reports-only tampered branch cannot render own-branch financial data: ${JSON.stringify(branchId)}`, async () => {
    await assert.rejects(render(staff(["REPORTS"]), "SALON_BEAUTY", undefined, branchId), /NOT_FOUND/);
    assert.equal(state.reads.canonicalItems, 0);
  });
}
for (const industry of ["SALON_BEAUTY", "CAR_WASH"]) {
  test(`broad Reports access cannot turn nonexistent explicit branch into Business-wide scope: ${industry}`, async () => {
    await assert.rejects(render(owner, industry, undefined, "cross-business"), /NOT_FOUND/);
  });
}
for (const access of [owner, staff(["REPORTS"])]) test(`Salon Reports reads canonical services without orphaned Staff/Appointment queries: ${access.granted ? access.effectiveBusinessRole : "denied"}`, async () => {
  const html = await render(access);
  assert.deepEqual(state.reads, { appointmentGroups: 0, linkedInvoices: 0, staffLookups: 0, canonicalItems: 1 });
  assert.match(html, /Sales Overview/);
  assert.match(html, /Payments Collected/);
  assert.match(html, /RM100\.00/);
  assert.match(html, /RM80\.00/);
  if (access.granted && access.effectiveBusinessRole === "STAFF") assert.match(html, /Balayage Highlights/);
  else assert.doesNotMatch(html, /Top Services/);
});
for (const scenario of [
  { name: "Owner", access: owner, visible: false },
  { name: "Business-scoped Group Manager", access: { ...owner, source: "GROUP_ACCESS", identityRole: "STAFF", actorRole: "GROUP_MANAGER", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" } as ResolvedBusinessAccess, visible: false },
  { name: "Staff with Reports and Dashboard", access: staff(["REPORTS", "DASHBOARD"]), visible: false },
  { name: "Reports-only Staff/custom role", access: staff(["REPORTS"]), visible: true },
  { name: "Reports-only ALL_BRANCHES Staff", access: staff(["REPORTS", "ALL_BRANCHES"]), visible: true },
]) test(`Salon Reports conditional Top Services: ${scenario.name}`, async () => {
  const html = await render(scenario.access);
  assert.equal(html.includes("Top Services"), scenario.visible);
  assert.equal(html.includes("Balayage Highlights"), scenario.visible);
  if (scenario.visible) { assert.match(html, /<td>25<\/td>/); assert.match(html, /RM6,250\.00/); }
  for (const anchor of ["Sales Overview", "Net Sales", "Transactions", "Average Sale", "Refunds", "Discounts", "Payments Collected", "Business Expenses", "Operating Balance", "Not accounting profit.", "Refund Breakdown", "Expense Breakdown", "Expense Settlement", "More details", "RM100.00", "RM80.00"]) assert.ok(html.includes(anchor), anchor);
  assert.doesNotMatch(html, /Top Staff|Staff Performance|Appointment Performance|Appointments, service, staff/);
});

test("direct Staff fallback respects the same user permission check as Dashboard route", async () => {
  const html = await render(staff(["REPORTS", "DASHBOARD"]), "SALON_BEAUTY", ["REPORTS"]);
  assert.match(html, /Top Services/);
});
test("Staff without REPORTS is still rejected rather than receiving fallback access", async () => {
  await assert.rejects(render(staff(["DASHBOARD"])), /REDIRECT/);
});
test("non-Salon Reports keeps its existing service ranking even with Dashboard access", async () => {
  const html = await render(owner, "CAR_WASH");
  assert.match(html, /Top Services/); assert.match(html, /Non-Salon service/); assert.match(html, /RM60.00/);
});
test("Salon header describes financial review rather than staff/appointment performance", async () => {
  const html = await render();
  assert.match(html, /Review sales, payments, refunds and business expenses for Local Salon\./);
});
test("Reports-only empty canonical period does not create an empty Top Services section", async () => {
  await render(staff(["REPORTS"]));
  state.services = false;
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ range: "month" }) }));
  assert.doesNotMatch(html, /Top Services/);
});

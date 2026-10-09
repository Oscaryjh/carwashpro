import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ReactElement } from "react";
import type { NavItem } from "../../src/components/app-shell-frame";
import type { WalletHubProps } from "../../src/components/wallet/wallet-hub";
import type { HubQuery, resolveHubPeriod } from "../../src/lib/wallet/hub-presentation";

const require = createRequire(import.meta.url);
export const businessId = "11111111-1111-4111-8111-111111111111";
export const branchId = "22222222-2222-4222-8222-222222222222";
export const customerId = "33333333-3333-4333-8333-333333333333";
export const fixture = {
  overview: { currentBalance: { paid: "80.00", bonus: "20.00", total: "100.00" }, period: { topUps: "100.00", topUpBonus: "20.00", walletUsed: "30.00", walletRefunds: "10.00", topUpReversals: "0.00", voidRestores: "0.00" }, fromDate: new Date("2026-10-01Z"), toDateExclusive: new Date("2026-11-01Z"), branchId: null },
  transactions: { rows: [{ id: "group1", date: new Date("2026-10-01T18:00:00Z"), customerId, customerName: "Alice", type: "TOP_UP" as const, amount: "110.00", paidAmount: "100.00", bonusAmount: "10.00", balanceAfterPaid: "180.00", balanceAfterBonus: "30.00", balanceAfterTotal: "210.00", invoiceId: "invoice1", reference: "TOP-1", paymentMethod: "CASH", staffName: "Owner", branchId, branchName: "Local branch" }], nextCursor: "next-cursor" },
  topUps: { rows: [{ topUpId: "top1", date: new Date("2026-10-01T18:00:00Z"), customerId, customerName: "Alice", paidAmount: "100.00", bonusAmount: "10.00", totalAdded: "110.00", paymentMethod: "CASH", reference: "TOP-1", staffName: "Owner", branchId, branchName: "Local branch", status: "Posted" as const }], nextCursor: "next-cursor" },
  balances: { rows: [{ customerId, customerName: "Alice", paidBalance: "80.00", bonusBalance: "20.00", totalBalance: "100.00", lastActivityAt: new Date("2026-10-01T18:00:00Z") }], nextCursor: "next-cursor" },
} satisfies { overview: NonNullable<WalletHubProps["overview"]>; transactions: NonNullable<WalletHubProps["transactions"]>; topUps: NonNullable<WalletHubProps["topUps"]>; balances: NonNullable<WalletHubProps["balances"]> };
export async function walletHubHarness() {
  const state = { role: "BUSINESS_OWNER", modules: ["POS", "SALON", "WALLET"], denied: false, invoiceAllowed: true, customerAllowed: true, branches: [{ id: branchId, name: "Local branch" }], calls: [] as Array<{ reader: string; ctx: Record<string, unknown>; input: Record<string, unknown> }>, pathname: "/wallet", empty: false };
  const testState = Object.assign(state, { readerError: undefined as Error | undefined });
  const globals = globalThis as typeof globalThis & { __walletHubUI?: { state: typeof testState; fixture: typeof fixture } };
  globals.__walletHubUI = { state: testState, fixture };
  const stubs: Record<string, string> = {
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children);",
    "next/navigation": "export const usePathname=()=>globalThis.__walletHubUI.state.pathname;export const useSearchParams=()=>new URLSearchParams();export function notFound(){throw Error('NOT_FOUND')};export function redirect(){throw Error('REDIRECT')};",
    "@/lib/tenant": `export async function getBusinessContext(){const s=globalThis.__walletHubUI.state;return{businessId:'${businessId}',isPlatformAdmin:s.role==='PLATFORM_ADMIN',user:{userId:'44444444-4444-4444-8444-444444444444',businessId:'${businessId}',role:s.role,permissions:[],branchId:null},access:{granted:true,businessId:'${businessId}',source:'DIRECT_BUSINESS',effectiveBusinessRole:s.role,permissions:[],identityRole:s.role}}};`,
    "@/lib/prisma": "export const prisma={business:{findUnique:async()=>({name:'Local',industryType:'SALON_BEAUTY',cashierShiftsEnabled:true}),findUniqueOrThrow:async()=>({timezone:'Asia/Singapore',businessDayCutoffTime:'02:00'})},branch:{findMany:async()=>globalThis.__walletHubUI.state.branches},invoice:{findMany:async()=>[{id:'invoice1'}]}};",
    "@/lib/wallet/hub-scope": `export async function resolveWalletHubScope(ctx){const s=globalThis.__walletHubUI.state;if(s.denied||ctx.businessId!=='${businessId}'||s.role!=='BUSINESS_OWNER')throw Object.assign(Error('Wallet access denied'),{code:'WALLET_ACCESS_DENIED'});if(!s.modules.includes('WALLET')||!s.modules.includes('POS'))throw Object.assign(Error('Unavailable'),{code:'WALLET_UNAVAILABLE'});if(ctx.branchId&&!s.branches.some(b=>b.id===ctx.branchId))throw Object.assign(Error('Branch denied'),{code:'WALLET_ACCESS_DENIED'});return{businessId:ctx.businessId,branchId:ctx.branchId??null}};`,
    "@/lib/wallet/hub-read-model": `async function read(reader,ctx,input){const t=globalThis.__walletHubUI;if(t.state.readerError)throw t.state.readerError;t.state.calls.push({reader,ctx,input});const data=t.fixture[reader];return t.state.empty&&reader!=='overview'?{rows:[],nextCursor:null}:data};export const readWalletHubOverview=(...a)=>read('overview',...a);export const readWalletHubTransactions=(...a)=>read('transactions',...a);export const readWalletHubTopUps=(...a)=>read('topUps',...a);export const readWalletHubCustomerBalances=(...a)=>read('balances',...a);`,
    "@/lib/business-groups/business-access": "export const hasBusinessCapability=(access,cap)=>cap==='VIEW_INVOICES'?globalThis.__walletHubUI.state.invoiceAllowed:globalThis.__walletHubUI.state.customerAllowed;",
    "@/lib/modules/entitlements": "export const loadBusinessModuleContext=async()=>({enabledModules:new Set(globalThis.__walletHubUI.state.modules)});",
    "@/lib/auth/mfa-feature": "export const isMfaFeatureEnabled=()=>false;",
    "@/lib/auth/business-context-token": "export const createBusinessContextToken=()=>{throw Error('unexpected token')};",
    "@/lib/approvals/service": "export const actionCenterDomains=[];export const resolveUnifiedApprovalContext=async()=>null;export const isUnifiedApprovalCenterAvailable=()=>false;export const getUnifiedApprovalCounts=()=>{throw Error('unexpected approvals')};",
    "@/lib/business-groups/business-context": "export const getAvailableBusinessContexts=()=>{throw Error('unexpected context')};",
    "@/lib/business-groups/all-stores-access": "export const getAvailableGroupReportingContexts=()=>{throw Error('unexpected groups')};",
    "@/components/business-context-switcher": "export const BusinessContextSwitcher=()=>null;",
    "@/components/pwa-install-button": "export const PwaInstallButton=()=>null;",
    "@/components/sign-out-form": "export const SignOutForm=()=>null;",
  };
  const bundle = await build({ stdin: { contents: 'export {default as Page} from "./src/app/(business)/wallet/page";export {WalletHub} from "./src/components/wallet/wallet-hub";export * from "./src/lib/wallet/hub-presentation";export {AppShell} from "./src/components/app-shell";', resolveDir: process.cwd() }, write: false, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "wallet-hub-io", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "hub-io" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "hub-io" }, a => ({ contents: stubs[a.path], loader: "ts", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,key)=>key});", loader: "js" }));
  } }] });
  type API = { Page: (props: { searchParams: Promise<Record<string, string | string[]>> }) => Promise<ReactElement<WalletHubProps>>; WalletHub: (props: WalletHubProps) => ReactElement; AppShell: (props: { user: object; access: object; children: null }) => Promise<ReactElement<{ navItems: NavItem[] }>>; parseHubQuery: (query: Record<string, string | string[]>) => HubQuery; hubHref: (query: HubQuery, change?: Partial<HubQuery>) => string; nextHubQuery: (query: HubQuery, cursor: string) => HubQuery; previousHubQuery: (query: HubQuery) => HubQuery | null };
  const compiled = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  return { api: compiled.exports as API & { resolveHubPeriod: typeof resolveHubPeriod }, state: testState, close: () => { delete globals.__walletHubUI; } };
}

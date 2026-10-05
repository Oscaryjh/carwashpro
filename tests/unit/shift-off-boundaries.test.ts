import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = { enabled: false, writes: 0, audits: 0, role: "BUSINESS_OWNER", permissions: [] as string[] };
const globals = globalThis as typeof globalThis & { __shiftOffFixture?: typeof state };
let directory: string;
type Entry = { href?: string; label: string; icon?: string; children?: Entry[] };
let subject: {
  endShiftAction(data: FormData): Promise<void>;
  resolveStaleShiftAction(data: FormData): Promise<void>;
  startShiftAction(data: FormData): Promise<void>;
  ClosingPage(props: { searchParams: Promise<{ date?: string }> }): Promise<ReactElement>;
  AppShell(props: { user: { userId: string; businessId: string; role: string; permissions: string[] }; children: null }): Promise<ReactElement<{ navItems: Entry[] }>>;
};
before(async () => {
  globals.__shiftOffFixture = state;
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/shift-off-"));
  const stubs: Record<string, string> = {
    "next/link": `import {createElement} from 'react'; export default function Link({children,...props}){return createElement('a',props,children)}`,
    "next/navigation": `export const usePathname=()=>'/closing';export const useSearchParams=()=>new URLSearchParams();export function redirect(url){throw Error('REDIRECT:'+url)};export function notFound(){throw Error('NOT_FOUND')}`,
    "next/cache": `export const revalidatePath=()=>{};`,
    "@/lib/prisma": `const state=globalThis.__shiftOffFixture;
      const shift={id:'11111111-1111-4111-8111-111111111111',businessId:'business',cashierId:'actor',branchId:'branch',openingFloat:10,startedAt:new Date('2020-01-01T02:00:00Z'),status:'OPEN'};
      const aggregate=async()=>({_sum:{amount:0}});
      export const prisma={
        business:{findUnique:async()=>({name:'Local',industryType:'AUTO_DETAILING',cashierShiftsEnabled:state.enabled}),findUniqueOrThrow:async()=>({cashierShiftsEnabled:state.enabled,timezone:'Asia/Kuala_Lumpur',businessDayCutoffTime:'00:00'})},
        businessModuleEntitlement:{findMany:async()=>[{moduleKey:'POS',status:'ENABLED',enabledFrom:new Date(0),enabledUntil:null}]},
        cashierShift:{findFirst:async()=>({...shift}),findMany:async()=>[],findUniqueOrThrow:async()=>({...shift,status:'CLOSED'}),updateMany:async()=>{state.writes++;return {count:1}}},
        payment:{aggregate,findFirst:async()=>null,findMany:async()=>[]},paymentRefund:{aggregate,findFirst:async()=>null,findMany:async()=>[]},cashierShiftExpensePayout:{aggregate,findFirst:async()=>null,findMany:async()=>[]},
        $queryRaw:async()=>[], $queryRawUnsafe:async()=>[], $executeRaw:async()=>0,
        $transaction:async fn=>fn(prisma)
      };`,
    "@/lib/audit": `export const getAuditRequestContext=async()=>({});export const writeAuditLog=async()=>{globalThis.__shiftOffFixture.audits++};`,
    "@/lib/auth/business-user": `export const requireBusinessUser=async()=>({businessId:'business',user:{userId:'actor',role:globalThis.__shiftOffFixture.role,permissions:globalThis.__shiftOffFixture.permissions}});`,
    "@/lib/tenant": `export const requireBusinessContext=async()=>({businessId:'business',industryType:'AUTO_DETAILING',user:{userId:'actor',role:globalThis.__shiftOffFixture.role,permissions:globalThis.__shiftOffFixture.permissions}});`,
    "@/lib/branches": `export const resolveOperationalBranchId=async()=> 'branch';export const canAccessOperationalBranch=()=>true;export const getOperationalBranches=async()=>{throw Error('OFF_ROUTE_REACHED_OPERATIONAL_LOADING')};`,
    "@/lib/business-groups/business-access": `export const resolveBusinessAccess=async()=>({granted:true});export const hasBusinessCapability=()=>true;`,
    "@/lib/auth/mfa-feature": `export const isMfaFeatureEnabled=()=>false;`,
    "@/lib/auth/business-context-token": `export const createBusinessContextToken=()=>{throw Error('unexpected token')};`,
    "@/lib/approvals/service": `export const actionCenterDomains=[];export const resolveUnifiedApprovalContext=async()=>null;export const isUnifiedApprovalCenterAvailable=()=>false;export const getUnifiedApprovalCounts=()=>{throw Error('unexpected approvals')};`,
    "@/lib/business-groups/business-context": `export const getAvailableBusinessContexts=()=>{throw Error('unexpected contexts')};`,
    "@/lib/business-groups/all-stores-access": `export const getAvailableGroupReportingContexts=()=>{throw Error('unexpected groups')};`,
    "@/components/business-context-switcher": `export const BusinessContextSwitcher=()=>null;`,
    "@/components/pwa-install-button": `export const PwaInstallButton=()=>null;`,
    "@/components/sign-out-form": `export const SignOutForm=()=>null;`,
  };
  await build({stdin:{contents:`export * from './src/app/(business)/closing/actions';export {default as ClosingPage} from './src/app/(business)/closing/page';export {AppShell} from './src/components/app-shell';`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(directory,'subject.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-io',setup(b){
    b.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'external-io'}:undefined);
    b.onLoad({filter:/.*/,namespace:'external-io'},args=>({contents:stubs[args.path],resolveDir:process.cwd()}));
  }}]});
  subject=createRequire(import.meta.url)(join(directory,'subject.cjs'));
});
after(async()=>{delete globals.__shiftOffFixture;if(directory)await rm(directory,{recursive:true,force:true,maxRetries:3});});
beforeEach(()=>{state.enabled=false;state.writes=0;state.audits=0;state.role='BUSINESS_OWNER';state.permissions=[];});
function form(){const data=new FormData();data.set('shiftId','11111111-1111-4111-8111-111111111111');data.set('closingCash','10');data.set('countedCash','10');data.set('notes','');data.set('reason','Historical shift review');data.set('openingFloat','10');return data;}
for(const action of ['endShiftAction','resolveStaleShiftAction'] as const){
  test(`${action}: OFF rejects an existing OPEN shift without mutation or audit`,async()=>{
    await assert.rejects(subject[action](form()),e=>e instanceof Error && decodeURIComponent(e.message).includes('Cashier shifts are disabled for this business.'));
    assert.equal(state.writes,0);assert.equal(state.audits,0);
  });
  test(`${action}: ON preserves close and audit with balanced cash`,async()=>{
    state.enabled=true;
    await assert.rejects(subject[action](form()),/REDIRECT:.*type=success/);
    assert.equal(state.writes,1);assert.equal(state.audits,1);
  });
}
test('Start Shift keeps its existing OFF rejection',async()=>{
  await assert.rejects(subject.startShiftAction(form()),e=>e instanceof Error && decodeURIComponent(e.message).includes('Cashier shifts are disabled'));
  assert.equal(state.writes,0);assert.equal(state.audits,0);
});
for(const date of [undefined,'2020-01-01','2026-10-05']){
  test(`OFF closing route short-circuits operational UI for date=${date}`,async()=>{
    const html=renderToStaticMarkup(await subject.ClosingPage({searchParams:Promise.resolve(date?{date}:{})}));
    assert.match(html,/Cashier shifts are disabled/);assert.doesNotMatch(html,/<form|Start Shift|End Shift|Resolve stale shift|Cash in drawer/);
  });
}
async function items(){return (await subject.AppShell({user:{role:state.role,userId:'actor',businessId:'business',permissions:state.permissions},children:null})).props.navItems;}
test('sidebar OFF hides Closing, updated ON restores the original entry and order',async()=>{
  const off=await items();assert.equal(off.some(n=>n.href==='/closing'),false);
  state.enabled=true;const on=await items();assert.equal(on.filter(n=>n.href==='/closing').length,1);
  assert.equal(on.find(n=>n.href==='/closing')?.icon,'shiftClosing');
  assert.deepEqual(on.filter(n=>n.href!=='/closing'),off);
  state.enabled=false;assert.deepEqual(await items(),off);
});
test('sidebar ON does not grant Staff permission; existing CLOSING permission still works',async()=>{
  state.enabled=true;state.role='STAFF';state.permissions=['CASHIER'];
  assert.equal((await items()).some(n=>n.href==='/closing'),false);
  state.permissions=['CLOSING'];assert.equal((await items()).some(n=>n.href==='/closing'),true);
});

import {build} from "esbuild";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {createRequire} from "node:module";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type { DailyClosingReadiness } from "../../src/lib/closing/readiness";

export async function renderClosingPanel(props:Record<string,unknown>) {
 const directory=await mkdtemp(join(process.cwd(),"node_modules/.cache/closing-ui-"));
 try{await build({entryPoints:["src/components/daily-closing-snapshot-panel.tsx"],outfile:join(directory,"panel.cjs"),bundle:true,packages:"external",platform:"node",format:"cjs",jsx:"automatic",plugins:[{name:"ui-host",setup(b){b.onResolve({filter:/^next\/(navigation|link)$|^@\/app\/.*\/actions$/},a=>({path:a.path,namespace:"ui-host"}));b.onLoad({filter:/.*/,namespace:"ui-host"},a=>({contents:a.path.endsWith("link")?'import {createElement} from "react";export default function Link({children,...props}){return createElement("a",props,children)}':a.path.endsWith("navigation")?'export function useRouter(){return {refresh(){}}}':'export async function closeDailySnapshotAction(){throw Error("unexpected write")} export async function manualClosingWhatsAppSendAction(){throw Error("unexpected write")}',resolveDir:process.cwd()}));}}]});const {DailyClosingSnapshotPanel}=createRequire(import.meta.url)(join(directory,"panel.cjs"));return renderToStaticMarkup(createElement(DailyClosingSnapshotPanel,props));}finally{await rm(directory,{recursive:true,force:true})}
}

// Render the real page, replacing authenticated/read I/O only. Permissions,
// date helpers, page visibility decisions and the actual panel remain real.
export async function renderClosingFixture(overrides: {
  canConfirm?: boolean; readiness?: DailyClosingReadiness | null; ownOpen?: boolean;
  cashierShiftsEnabled?: boolean;
  branches?: {id:string;name:string}[];
  searchParams?: {date?:string;branchId?:string};
  snapshot?: "valid" | "invalid";
  mutatePayload?: (payload: any) => void;
} = {}) {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/closing-page-ui-"));
  const queries: string[] = [];
  const branch = {id:"branch",name:"Main"};
  const shift = {id:"shift",branchId:branch.id,branch,cashier:{name:"Cashier"},startedAt:new Date(),openingFloat:50,payments:[],refunds:[],expensePayouts:[]};
  const readiness = overrides.readiness === undefined ? {status:"READY",businessDate:"2026-10-02",isCurrentBusinessDate:true,shiftCount:1} : overrides.readiness;
  const fixture = {
    context:{businessId:"business",industryType:"SALON_BEAUTY",user:{userId:"cashier",role:"STAFF",permissions:overrides.canConfirm===false?["CLOSING"]:["CLOSING","CONFIRM_DAILY_CLOSING"]}},
    branches: overrides.branches ?? [branch],
    readiness:async()=>{queries.push("readiness");if(!readiness)throw Error("unavailable");return readiness;},
    db:{business:{findUniqueOrThrow:async()=>({timezone:"Asia/Kuching",businessDayCutoffTime:"02:00",cashierShiftsEnabled:overrides.cashierShiftsEnabled??true})},cashierShift:{findFirst:async()=>overrides.ownOpen?shift:null,findMany:async()=>[],count:async()=>0},dailyClosingSnapshot:{findUnique:async(args:any)=>{queries.push("snapshot");const scope=args.where.businessId_branchId_businessDate;if(scope.businessId!=="business"||scope.branchId!=="branch")throw Error("Unscoped snapshot read");return snapshot;}}},
    report: async()=>{queries.push("full-report");return {branchId:branch.id,branchName:branch.name,businessName:"Synthetic",dateValue:"2026-10-02",generatedAtLabel:"Now",industry:"SALON_BEAUTY",preview:"Synthetic preview",timeZone:"Asia/Kuching",businessDayCutoffTime:"02:00",report:{alerts:[],cashDrawer:{expensePayoutCents:0},financial:{grossSalesCents:0,netSalesCents:0,collectedCents:0,outstandingCents:0,refundsCents:0,discountsCents:0},invoiceCounts:{paid:0,partial:0,refunded:0,total:0,unpaid:0},operations:{averageSpendCents:0,cancelled:0,completed:0,customersServed:0,newCustomers:0,returningCustomers:0,vehiclesServed:0},packages:{amountCents:0,redemptions:0,sold:0},paymentMethods:[],topServices:[]}};},
  };
  let snapshot:any=null;
  if(overrides.snapshot){const source=await fixture.report();queries.length=0;snapshot={id:"frozen",closedAt:new Date("2026-10-02T02:00:00Z"),closedBy:{name:"Original closer"},closingWhatsAppSends:[],whatsappText:"Frozen message",reportDataJson:overrides.snapshot==="invalid"?{}:{version:2,businessDate:"2026-10-02",timezone:"Asia/Kuching",businessDayCutoffTime:"02:00",businessDayDefinitionVersion:1,metricDefinitionVersion:1,business:{id:"business",name:"Frozen Business"},branch,closedBy:{id:"cashier",name:"Original closer"},closingNote:"Original note",generatedAt:"2026-10-02T02:00:00Z",cash:{expectedCents:12300,actualCents:12300,differenceCents:0},report:source.report}};}
  if (snapshot && overrides.mutatePayload) overrides.mutatePayload(snapshot.reportDataJson);
  const state=globalThis as typeof globalThis & {closingUi?:typeof fixture};state.closingUi=fixture;
  try {
    await build({entryPoints:["src/app/(business)/closing/page.tsx"],outfile:join(directory,"page.cjs"),bundle:true,packages:"external",platform:"node",format:"cjs",jsx:"automatic",plugins:[{name:"closing-ui-reads",setup(b){
      b.onResolve({filter:/^next\/(navigation|link)$|^@\/lib\/(prisma|tenant|branches|closing\/readiness|daily-closing\/query)$|^@\/app\/.*\/actions$|^\.\/actions$/},a=>({path:a.path,namespace:"closing-ui-reads"}));
      b.onLoad({filter:/.*/,namespace:"closing-ui-reads"},a=>({resolveDir:process.cwd(),contents:
        a.path.endsWith("/link")?'import {createElement} from "react";export default function Link({children,...props}){return createElement("a",props,children)}':
        a.path.endsWith("/navigation")?'export function useRouter(){return {refresh(){}}} export function redirect(){throw Error("unexpected redirect")}':
        a.path.endsWith("/prisma")?'export const prisma=globalThis.closingUi.db;':
        a.path.endsWith("/tenant")?'export const requireBusinessContext=async()=>globalThis.closingUi.context;':
        a.path.endsWith("/branches")?'export const getOperationalBranches=async()=>globalThis.closingUi.branches;':
        a.path.endsWith("/readiness")?'export const getDailyClosingReadiness=(...args)=>globalThis.closingUi.readiness(...args);':
        a.path.endsWith("/query")?'export const getDailyClosingReport=(...args)=>globalThis.closingUi.report(...args);':
        'export async function endShiftAction(){throw Error("unexpected write")} export async function startShiftAction(){throw Error("unexpected write")} export async function resolveStaleShiftAction(){throw Error("unexpected write")} export async function closeDailySnapshotAction(){throw Error("unexpected write")} export async function manualClosingWhatsAppSendAction(){throw Error("unexpected write")}'
      }));
    }}]});
    const page=createRequire(import.meta.url)(join(directory,"page.cjs")).default;
    return {html:renderToStaticMarkup(await page({searchParams:Promise.resolve(overrides.searchParams ?? {})})),queries};
  } finally {delete state.closingUi;await rm(directory,{recursive:true,force:true});}
}

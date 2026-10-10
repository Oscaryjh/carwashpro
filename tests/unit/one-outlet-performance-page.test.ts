import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

test("Performance preserves authorised inactive branch history and never defaults to first legacy branch", async () => {
  const cache = join(process.cwd(), "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "outlet-performance-test-"));
  const key = "__outletPerformanceTest";
  const state = { branchId: "old", role: "BUSINESS_OWNER", calls: [] as string[] };
  (globalThis as any)[key] = state;
  const oldFlag = process.env.TETAMU_PERFORMANCE_PHASE2;
  process.env.TETAMU_PERFORMANCE_PHASE2 = "true";
  try {
    const outfile = join(directory, "page.cjs");
    await build({ entryPoints: ["src/app/(business)/team/performance/page.tsx"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent",
      plugins: [{ name: "page-boundaries", setup(builder) {
        builder.onResolve({ filter: /^(?:@\/lib\/(?:report-outlet-context|auth\/business-user|business-groups\/business-access|prisma|performance\/(?:time|dashboard|targets-contract))|\.\/target-editor|next\/navigation)$/ }, args => ({ path: args.path, namespace: "test-boundary" }));
        builder.onLoad({ filter: /.*/, namespace: "test-boundary" }, args => {
          const s = `globalThis[${JSON.stringify(key)}]`;
          const contents = args.path.endsWith("report-outlet-context") ? `export async function resolveReportOutletScope(input){const id=Object.hasOwn(input,'explicitBranchInput')?input.explicitBranchInput:'new';if(!['old','new'].includes(id)||(${s}.role==='STAFF'&&id!==${s}.branchId))return {kind:'denied'};return {kind:'ready',topologyMode:'single_outlet',selection:{kind:'branch',branchId:id},branches:[{id:'old',name:'Historical'},{id:'new',name:'Current'}],historical:id==='old'}}` :
            args.path.endsWith("auth/business-user") ? `export async function requireBusinessUserWithAnyCapability(){return {businessId:'a',user:{userId:'owner',role:${s}.role,branchId:${s}.branchId},access:{source:'DIRECT_BUSINESS'}}}` :
            args.path.endsWith("business-access") ? "export const hasBusinessCapability=()=>true" :
            args.path.endsWith("/prisma") ? `export const prisma={branch:{findMany:async({where})=>{if(where.businessId!=='a')throw Error('wrong business');return [{id:'old',name:'Historical',status:'INACTIVE'},{id:'new',name:'Current',status:'ACTIVE'}].filter(b=>(!where.status||b.status===where.status)&&(!where.id||b.id===where.id))}},business:{findUniqueOrThrow:async()=>({timezone:'Asia/Kuala_Lumpur'})}}` :
            args.path.endsWith("/time") ? "export const localPerformanceDate=()=> '2026-09-28',performanceTimezone=x=>x" :
            args.path.endsWith("/dashboard") ? `export async function readPerformanceDashboard(actor){${s}.calls.push(actor.branchId);throw Error('DASHBOARD:'+actor.branchId)}` :
            args.path.endsWith("/targets-contract") ? "export const formatTargetMoney=String" :
            args.path === "./target-editor" ? "export const TargetEditor=()=>null" : "export function notFound(){throw Error('NOT_FOUND')}";
          return { contents };
        });
      } }],
    });
    const page = createRequire(import.meta.url)(outfile).default;
    for (const tab of ["overview", "targets"]) {
      await assert.rejects(page({ searchParams: Promise.resolve({ branch: "old", tab }) }), /DASHBOARD:old/);
    }
    await assert.rejects(page({ searchParams: Promise.resolve({}) }), /DASHBOARD:new/);
    state.branchId = ""; state.calls = [];
    await assert.rejects(page({ searchParams: Promise.resolve({}) }), /DASHBOARD:new/);
    assert.deepEqual(state.calls, ['new']);
    await assert.rejects(page({ searchParams: Promise.resolve({ branch: "foreign" }) }), /NOT_FOUND/);
    state.role = "STAFF"; state.branchId = "old";
    await assert.rejects(page({ searchParams: Promise.resolve({ branch: "new" }) }), /NOT_FOUND/);
  } finally {
    if (oldFlag === undefined) delete process.env.TETAMU_PERFORMANCE_PHASE2; else process.env.TETAMU_PERFORMANCE_PHASE2 = oldFlag;
    delete (globalThis as any)[key]; await rm(directory, { recursive: true, force: true });
  }
});

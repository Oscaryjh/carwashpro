import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { CurrentOutletContext } from "../../src/lib/outlet-context";
const require = createRequire(import.meta.url);
const state = { count: 1, role: "BUSINESS_OWNER", revoked: false };
const globals = globalThis as typeof globalThis & { __phase1c2?: typeof state };
let directory: string;
let api: typeof import("../../src/lib/phase1c2-outlet-context");
let actions: typeof import("../../src/app/(business)/phase1c2-location-actions");
before(async () => {
  globals.__phase1c2 = state; directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/phase1c2-"));
  const stubs: Record<string, string> = {
    "@/lib/auth/business-user": `export async function requireBusinessUser(){return {businessId:'business',user:{userId:'actor'}}} export const requireBusinessUserForModule=requireBusinessUser;`,
    "next/navigation": `export function redirect(url){throw Object.assign(new Error(url),{url})}`,
    "./closing/actions": `export async function startShiftAction(){throw Error('OLD_WRITER_REACHED')}`,
    "server-only": "export {};",
    "@/lib/business-groups/business-access": `export const hasBusinessCapability=()=>false;export async function resolveBusinessAccess(){const s=globalThis.__phase1c2;return s.revoked?{granted:false}:{granted:true,businessId:'business',industryType:'SALON_BEAUTY',effectiveBusinessRole:s.role,branchId:s.role==='STAFF'?'A':null}}`,
    "@/lib/modules/entitlements": `export class ModuleNotEnabledError extends Error{};export async function requireBusinessModules(){}`,
    "@/lib/prisma": `export const prisma={branch:{findMany:async()=>Array.from({length:globalThis.__phase1c2.count},(_,i)=>({id:i?'B':'A',name:'Outlet'}))}}`,
  };
  await build({entryPoints:["src/lib/phase1c2-outlet-context.ts"],outfile:join(directory,"guard.cjs"),bundle:true,platform:"node",packages:"external",format:"cjs",plugins:[{name:"boundaries",setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],resolveDir:process.cwd()}));}}]});
  api=require(join(directory,"guard.cjs"));
  await build({entryPoints:["src/app/(business)/phase1c2-location-actions.ts"],outfile:join(directory,"actions.cjs"),bundle:true,platform:"node",packages:"external",format:"cjs",plugins:[{name:"action-boundaries",setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],resolveDir:process.cwd()}));}}]});
  actions=require(join(directory,"actions.cjs"));
});
after(async()=>{delete globals.__phase1c2;if(directory)await rm(directory,{recursive:true,force:true});});
const input={businessId:"business",actorUserId:"actor",capability:"RUN_CLOSING" as const,operation:"write" as const};
test("single create guard resolves current branch without changing operation/shift fields",async()=>{
  const rendered=await api.resolvePhase1c2OutletContext(input);const form=new FormData();form.set("operationKey","original-key");form.set("openingFloat","original-openingFloat");
  const result=await api.guardPhase1c2Create({...input,rendered,formData:form});
  assert.equal(result.get("branchId"),"A");assert.equal(result.get("operationKey"),"original-key");assert.equal(result.get("openingFloat"),"original-openingFloat");assert.equal(form.has("branchId"),false);
});
test("stale topology, revoked access, explicit foreign branch and duplicate input fail closed",async()=>{
  const rendered=await api.resolvePhase1c2OutletContext(input);
  for(const branch of ["B","foreign",""]){const form=new FormData();form.set("branchId",branch);await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:form}));}
  const duplicate=new FormData();duplicate.append("branchId","A");duplicate.append("branchId","A");await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:duplicate}));
  state.count=2;await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:new FormData()}));state.count=1;
  state.revoked=true;await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:new FormData()}));state.revoked=false;
});
test("legacy Staff with one visible branch remains legacy and requires explicit branch",async()=>{
  state.count=2;state.role="STAFF";const rendered=await api.resolvePhase1c2OutletContext(input);assert.equal(rendered.kind,"legacy_multi_branch");
  await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:new FormData()}));
  const form=new FormData();form.set("branchId","A");assert.equal((await api.guardPhase1c2Create({...input,rendered,formData:form})).get("branchId"),"A");
  state.count=1;state.role="BUSINESS_OWNER";
});
test("zero-location current creation never falls back to Business-wide",async()=>{
  state.count=0;const rendered=await api.resolvePhase1c2OutletContext(input);assert.equal(rendered.kind,"no_location");
  await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:new FormData()}));state.count=1;
});
test("document attribution is not accepted as a current-create snapshot",async()=>{
  const rendered={kind:"single_outlet",businessId:"foreign",internalBranchId:"A"} as CurrentOutletContext;
  await assert.rejects(api.guardPhase1c2Create({...input,rendered,formData:new FormData()}));
});

test("stale create wrappers reject before writers and offer a safe reload message",async()=>{
  const rendered=await api.resolvePhase1c2OutletContext(input);state.count=2;
  try {
    await assert.rejects(actions.startOutletShiftAction(rendered,new FormData()),/closing\?type=error&message=.*Reload/);
  } finally { state.count=1; }
});

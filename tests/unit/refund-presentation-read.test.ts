import assert from "node:assert/strict";
import test from "node:test";
import {existsSync} from "node:fs";
import {build} from "esbuild";
import {mkdtemp,rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {join} from "node:path";

test("refund presentation authorizes owner and business/branch, reads real association and refundable balance without writes",async()=>{
 const entry="src/app/(business)/invoices/refund-presentation.ts";
 assert.ok(existsSync(entry),"authenticated read-only refund presentation must exist");
 const dir=await mkdtemp(join(process.cwd(),"node_modules/.cache/refund-read-"));
 try{
  await build({entryPoints:[entry],outfile:join(dir,"read.cjs"),bundle:true,packages:"external",platform:"node",format:"cjs",plugins:[{name:"read-boundaries",setup(b){
   b.onResolve({filter:/^@\/lib\/(auth\/business-user|branches|prisma)$/},a=>({path:a.path,namespace:"stub"}));
   b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:a.path.endsWith("prisma")?"export const prisma=globalThis.refundRead.db":a.path.endsWith("branches")?"export const authorizedOperationalBranchWhere=()=>({branchId:'branch'})":"export const requireBusinessUser=async p=>{globalThis.refundRead.permission=p;return {businessId:'business',user:globalThis.refundRead.user}}"}));
  }}]});
  const pkg={id:"pkg",status:"ACTIVE",remainingUses:10,totalUses:10,serviceBalances:[]};
  const invoice={id:"10000000-0000-4000-8000-000000000001",status:"PAID",workOrderId:null,customerPackageId:"pkg",customerPackage:pkg,items:[],payments:[]};
  let payment={method:"CASH",amount:200,refunds:[] as Array<{amount:number}>};
  const f={user:{role:"BUSINESS_OWNER"},permission:"",reads:[] as unknown[],db:{invoice:{findFirst:async(args:unknown)=>{f.reads.push(args);return invoice;}},payment:{findFirst:async(args:unknown)=>{f.reads.push(args);return payment;}}}};
  Object.assign(globalThis,{refundRead:f});
  const {refundPresentationAction}=createRequire(import.meta.url)(join(dir,"read.cjs"));
  const result=await refundPresentationAction(invoice.id,"20000000-0000-4000-8000-000000000001");
  assert.equal(result.ok,true);assert.equal(result.refundableAmount,200);assert.equal(result.packagePurchaseRefund.refundableCents,20000);
  assert.equal(f.permission,"PROCESS_REFUND");assert.deepEqual((f.reads[0] as {where:object}).where,{id:invoice.id,businessId:"business",branchId:"branch"});
  for(const fixture of [{refunds:[],remaining:96},{refunds:[48],remaining:48},{refunds:[96],remaining:0},{refunds:[20,28],remaining:48}]){
   payment={method:"CASH",amount:96,refunds:fixture.refunds.map(amount=>({amount}))};
   const read=await refundPresentationAction(invoice.id,"20000000-0000-4000-8000-000000000001");
   assert.equal(read.refundableAmount,fixture.remaining,'DTO subtracts all persisted successful refund rows');
  }
  f.reads=[];f.user.role="STAFF";assert.equal((await refundPresentationAction(invoice.id,"20000000-0000-4000-8000-000000000001")).ok,false);assert.equal(f.reads.length,0);
  f.user.role="BUSINESS_OWNER";f.db.invoice.findFirst=async()=>null as never;
  assert.equal((await refundPresentationAction(invoice.id,"20000000-0000-4000-8000-000000000001")).ok,false);
 }finally{await rm(dir,{recursive:true,force:true});delete (globalThis as Record<string,unknown>).refundRead;}
});

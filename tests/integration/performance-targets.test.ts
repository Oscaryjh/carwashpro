import assert from "node:assert/strict";
import test,{after} from "node:test";
import { randomUUID,randomInt } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { previewTargets,publishTargets } from "../../src/lib/performance/targets";
import { readPerformanceDashboard } from "../../src/lib/performance/dashboard";
import { readPerformanceLedger } from "../../src/lib/performance/read";
import { capturePerformanceCheckout,capturePerformanceRefund } from "../../src/lib/performance/service";
import { DEFAULT_LEVELS,equalTargets,type TargetDraft,type TargetSnapshot } from "../../src/lib/performance/targets-contract";

const url=new URL(process.env.DATABASE_URL??"http://invalid");
assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/tetamu_performance_disposable_[a-z0-9_]+$/.test(url.pathname));
process.env.TETAMU_PERFORMANCE_PHASE1="true";process.env.TETAMU_PERFORMANCE_PHASE2="true";process.env.SESSION_SECRET="isolated-phase2-test-signing-secret-32-characters";
const db=new PrismaClient();after(()=>db.$disconnect());
async function fixture(){
  const business=await db.business.create({data:{name:"Phase2 isolated",slug:`phase2-${randomUUID()}`,timezone:"Asia/Kuching"}});
  const branch=await db.branch.create({data:{businessId:business.id,name:"Managed branch"}}),other=await db.branch.create({data:{businessId:business.id,name:"Other branch"}});
  const owner=await db.user.create({data:{businessId:business.id,branchId:branch.id,name:"Owner",role:"BUSINESS_OWNER"}});
  const manager=await db.user.create({data:{businessId:business.id,branchId:branch.id,name:"Granted reader",role:"STAFF",permissions:["PERFORMANCE_VIEW_TEAM"]}});
  const members=[];
  for(let i=0;i<7;i++){const phone=`+601${randomInt(10000000,99999999)}`;const a=await db.employeeAccount.create({data:{name:"Same Name",phoneNumber:phone,phoneNormalized:phone}});
    const m=await db.employeeBusinessMembership.create({data:{businessId:business.id,employeeAccountId:a.id,employeeCode:`P${i}`,fullName:"Same Name",phoneNumber:phone,phoneNumberNormalized:phone,joinedAt:new Date("2025-01-01Z")}});
    await db.employeeBranchAssignment.create({data:{businessId:business.id,branchId:branch.id,membershipId:m.id,isPrimary:true,canClockIn:false,effectiveFrom:new Date("2025-01-01Z")}});members.push(m);}
  const context={businessId:business.id,branchId:branch.id,actorUserId:owner.id};
  const draft:TargetDraft={year:2026,levels:DEFAULT_LEVELS,managerId:members[0].id,people:equalTargets(DEFAULT_LEVELS[0],30000000,members[0].id,members.slice(1).map(m=>m.id)),expectedRevision:0,reason:"Initial annual target allocation",confirmGap:false};
  return{business,branch,other,owner,manager,members,context,draft};
}
type F=Awaited<ReturnType<typeof fixture>>;
async function cash(f:F,amount="118",at="2026-08-01T04:00Z",assigned=true){return db.$transaction(async tx=>{
  const v=new Prisma.Decimal(amount),tax=amount==="118"?8:0,tip=amount==="118"?10:0;
  const invoice=await tx.invoice.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceNumber:`P2-${randomUUID()}`,subtotal:v.sub(tax).sub(tip),taxAmount:tax,tipAmount:tip,total:v,paidAmount:v,balance:0,status:"PAID"}});
  const payment=await tx.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceId:invoice.id,amount:v,method:"CASH",paidAt:new Date(at)}});
  await capturePerformanceCheckout(tx,{businessId:f.business.id,actorUserId:f.owner.id,paymentIds:[payment.id],input:assigned?{version:1,sales:[{membershipId:f.members[0].id,basisPoints:5000},{membershipId:f.members[1].id,basisPoints:5000}],tipMembershipId:tip?f.members[2].id:null}:null});return payment;
});}
const read=(f:F,extra:Partial<Parameters<typeof readPerformanceDashboard>[1]>={})=>readPerformanceDashboard(f.context,{year:2026,month:8,asOf:new Date("2026-09-05T10:00Z"),...extra},db);
async function publish(f:F,d=f.draft){const p=await previewTargets(f.context,d,db);return publishTargets(f.context,d,p.token,randomUUID(),db);}
const financial=async(f:F)=>JSON.stringify(await Promise.all([db.payment.findMany({where:{businessId:f.business.id}}),db.paymentRefund.findMany({where:{businessId:f.business.id}}),db.performanceReceipt.findMany({where:{businessId:f.business.id}}),db.performanceContribution.findMany({where:{businessId:f.business.id}})]),(_,v)=>typeof v==="bigint"?v.toString():v);

test("publish immutable target revision with audit and no financial mutations; levels don't modify individual targets",async()=>{
 const f=await fixture();await cash(f);const before=await financial(f);await publish(f);
 const second={...f.draft,levels:[61000000,81000000,101000000] as [number,number,number],expectedRevision:1,confirmGap:true,reason:"Adjust annual team thresholds"};await publish(f,second);
 const versions=await db.performanceTargetVersion.findMany({where:{businessId:f.business.id},orderBy:{revision:"asc"}});assert.equal(versions.length,2);assert.deepEqual((versions[1].snapshot as TargetSnapshot).people,(versions[0].snapshot as TargetSnapshot).people);assert.deepEqual(versions[1].previousSnapshot,versions[0].snapshot);
 assert.equal(await financial(f),before);assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:"PERFORMANCE_TARGET_PUBLISHED"}}),2);
 await assert.rejects(db.performanceTargetVersion.update({where:{id:versions[0].id},data:{reason:"attempt to rewrite history"}}),/immutable/);
 await assert.rejects(db.performanceTargetVersion.delete({where:{id:versions[0].id}}),/immutable/);
});
test("concurrent identical requests replay once; stale preview cannot overwrite",async()=>{
 const f=await fixture(),p=await previewTargets(f.context,f.draft,db),key=randomUUID();
 const result=await Promise.all([publishTargets(f.context,f.draft,p.token,key,db),publishTargets(f.context,f.draft,p.token,key,db)]);assert.deepEqual(result[0],result[1]);assert.equal(await db.performanceTargetVersion.count({where:{businessId:f.business.id}}),1);
 await assert.rejects(publishTargets(f.context,f.draft,p.token,randomUUID(),db),/版本/);
 await assert.rejects(publishTargets(f.context,{...f.draft,reason:"Changed request content"},p.token,key,db),/失效/);
});
test("explicit gap acknowledgement, zero personal target, copy prior year draft does not publish itself",async()=>{
 const f=await fixture(),d={...f.draft,people:[{membershipId:f.members[0].id,amount:0}]};
 const p=await previewTargets(f.context,d,db);assert.equal(p.preview.next.gap,60000000);assert.equal(p.preview.after.people[0].state,"NO_TARGET");
 await assert.rejects(publishTargets(f.context,d,p.token,randomUUID(),db),/差额/);await publish(f,{...d,confirmGap:true});
 await publish(f,{...f.draft,year:2025,reason:"Prior year explicit initial publish"});
 const out=await read(f);assert.ok(out.previousTarget);assert.equal(out.revision,1);assert.equal(await db.performanceTargetVersion.count({where:{businessId:f.business.id}}),2);
});
test("independent read/manage permission, revocation, branch/member/year isolation",async()=>{
 const f=await fixture(),reader={...f.context,actorUserId:f.manager.id};
 await readPerformanceDashboard(reader,{year:2026,month:8,asOf:new Date()},db);
 await assert.rejects(previewTargets(reader,f.draft,db),/permission/);
 await db.user.update({where:{id:f.manager.id},data:{permissions:["PERFORMANCE_MANAGE_TARGETS"]}});
 const p=await previewTargets(reader,f.draft,db);
 await db.user.update({where:{id:f.manager.id},data:{permissions:["APPROVE_LEAVE"]}});
 await assert.rejects(publishTargets(reader,f.draft,p.token,randomUUID(),db),/permission/);
 await assert.rejects(readPerformanceDashboard(reader,{year:2026,month:8,asOf:new Date()},db),/permission/);
 await db.user.update({where:{id:f.manager.id},data:{permissions:["PERFORMANCE_VIEW_TEAM"]}});
 await assert.rejects(readPerformanceDashboard({...reader,branchId:f.other.id},{year:2026,month:8,asOf:new Date()},db),/branch access/);
 const g=await fixture();await assert.rejects(previewTargets(f.context,{...f.draft,managerId:null,people:[{membershipId:g.members[0].id,amount:1}]},db),/员工/);
 await assert.rejects(read(f,{employeeId:g.members[0].id}),/范围/);
 await assert.rejects(previewTargets({...f.context,branchId:g.branch.id},f.draft,db),/branch access/);
});
test("midyear complete can reach target; refund downgrades; no periodClosed gating",async()=>{
 const f=await fixture();await publish(f);const payment=await cash(f,"600000");let result=await read(f);
 assert.equal(result.annual.complete,true);assert.equal(result.level.level,1);assert.equal(result.progress.percent,100);
 await db.$transaction(async tx=>{const r=await tx.paymentRefund.create({data:{businessId:f.business.id,branchId:f.branch.id,paymentId:payment.id,invoiceId:payment.invoiceId,amount:1,method:"CASH",reason:"Target downgrade test",refundedAt:new Date("2026-08-02Z")}});await capturePerformanceRefund(tx,r.id,{businessId:f.business.id,actorUserId:f.owner.id});});
 result=await read(f);assert.equal(result.level.level,0);assert.equal(result.annual.team.total,59999900);assert.equal(result.target!.people[0].amount>0,true);
});
test("unassigned counts toward team completeness but personal progress remains unconfirmed",async()=>{
 const f=await fixture();await publish(f);await cash(f,"118",undefined,false);const out=await read(f);
 assert.equal(out.annual.complete,true);assert.equal(out.annual.team.total,11000);assert.equal(out.annual.unassigned.total,11000);assert.ok(out.annual.unassignedCount>0);assert.equal(out.members[0].progress.percent,null);assert.notEqual(out.progress.percent,null);
 assert.equal(out.annual.team.total,out.members.reduce((s,m)=>s+m.amount.total,0)+out.annual.unassigned.total);
});
test("flag-off gap and paid VOID cannot produce official achievement; unknown not zero",async()=>{
 const f=await fixture();await publish(f);const payment=await cash(f,"600000");process.env.TETAMU_PERFORMANCE_PHASE1="false";
 try{await cash(f);}finally{process.env.TETAMU_PERFORMANCE_PHASE1="true";}
 let out=await read(f);assert.equal(out.annual.uncapturedCount,1);assert.equal(out.level.level,null);assert.equal(out.progress.percent,null);assert.equal(out.details.find(s=>s.classification==="UNCAPTURED")!.qualifiedCents,null);
 await db.payment.update({where:{id:payment.id},data:{status:"VOID"}});out=await read(f);assert.equal(out.annual.pendingCount,1);assert.equal(out.annual.team.total,0);assert.equal(out.annual.complete,false);
});
test("departed or transferred employees stay in historical branch only; zero/empty years remain distinct",async()=>{
 const f=await fixture();await cash(f);await publish(f);
 await db.employeeBranchAssignment.updateMany({where:{membershipId:f.members[0].id},data:{effectiveUntil:new Date("2026-08-15Z"),status:"INACTIVE"}});
 await db.employeeBusinessMembership.update({where:{id:f.members[0].id},data:{status:"TERMINATED",terminatedAt:new Date("2026-08-15Z")}});
 const out=await read(f);assert.equal(out.members.find(m=>m.id===f.members[0].id)!.amount.total,5000);assert.equal(out.members.find(m=>m.id===f.members[0].id)!.status,"TERMINATED");
 const other=await readPerformanceDashboard({...f.context,branchId:f.other.id},{year:2026,month:8,asOf:new Date()},db);assert.equal(other.members.length,0);assert.equal(other.annual.complete,true);assert.equal(other.annual.team.total,0);assert.equal(other.progress.percent,null);
});
test("one annual source check, exact paginated totals and independent tip recipient; readonly no writes",async()=>{
 const f=await fixture();for(let i=0;i<27;i++)await cash(f);const before=await financial(f);let scans=0;
 const client=db.$extends({query:{performanceReceipt:{async findMany({args,query}){scans++;return query(args);}}}}) as unknown as PrismaClient;
 const out=await readPerformanceDashboard(f.context,{year:2026,month:8,asOf:new Date()},client);assert.equal(scans,1);assert.equal(out.totalRows,27);assert.equal(out.details.length,25);assert.equal(out.current.team.total,297000);assert.equal(out.members.find(m=>m.id===f.members[2].id)!.amount.total,27000);
 const next=await read(f,{page:2});assert.equal(next.details.length,2);assert.equal(next.current.team.total,out.current.team.total);assert.equal(new Set([...out.details,...next.details].map(s=>s.sourceKey)).size,27);
 assert.equal(await financial(f),before);const source=await readPerformanceLedger(f.context,{year:2026,asOf:new Date()},db);assert.deepEqual(out.annual.team,source.team);
 const tips=await read(f,{employeeId:f.members[2].id,component:"TIP"});assert.equal(tips.totalRows,27);
});
test("January previous December, cross-year refund, incomplete comparison and future months",async()=>{
 const f=await fixture(),payment=await cash(f,"118","2025-12-15T04:00Z");
 await db.$transaction(async tx=>{const r=await tx.paymentRefund.create({data:{businessId:f.business.id,branchId:f.branch.id,paymentId:payment.id,amount:118,method:"CASH",reason:"Cross year test refund",refundedAt:new Date("2026-01-02Z")}});await capturePerformanceRefund(tx,r.id,{businessId:f.business.id,actorUserId:f.owner.id});});
 const out=await read(f,{month:1,asOf:new Date("2026-01-10Z")});assert.equal(out.annual.team.total,-11000);assert.equal(out.previous.team.total,0);assert.equal(out.comparison.percent,null);assert.equal(out.members[0].months[1].future,true);
 const closed=await read(f,{month:1});assert.equal(closed.previous.team.total,11000);assert.equal(closed.comparison.delta,-22000);
 await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,amount:5,method:"CASH",paidAt:new Date("2025-12-05Z")}});
 assert.equal((await read(f,{month:1})).comparison.complete,false);
});

test("feature off never queries target tables; failed audit rolls back target; changed identity invalidates preview",async()=>{
 const f=await fixture();process.env.TETAMU_PERFORMANCE_PHASE2="false";
 try{await assert.rejects(read(f),/尚未启用/);await assert.rejects(previewTargets(f.context,f.draft,db),/尚未启用/);}finally{process.env.TETAMU_PERFORMANCE_PHASE2="true";}
 const p=await previewTargets(f.context,f.draft,db);
 const fail=db.$extends({query:{auditLog:{async create(){throw new Error("Injected target audit failure");}}}}) as unknown as PrismaClient;
 await assert.rejects(publishTargets(f.context,f.draft,p.token,randomUUID(),fail),/audit failure/);assert.equal(await db.performanceTargetVersion.count({where:{businessId:f.business.id}}),0);
 await db.employeeBusinessMembership.update({where:{id:f.members[0].id},data:{fullName:"Changed identity after preview"}});
 await assert.rejects(publishTargets(f.context,f.draft,p.token,randomUUID(),db),/成员/);
});
test("noncash excluded; changed operating policy quarantines frozen period and exposes source detail",async()=>{
 const f=await fixture();await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,amount:10,method:"PACKAGE",paidAt:new Date("2026-08-10Z")}});
 let result=await read(f);assert.equal(result.annual.complete,true);assert.equal(result.annual.uncapturedCount,0);assert.equal(result.details[0].classification,"EXCLUDED_NONCASH");
 await cash(f,"118","2026-12-31T16:01Z");await db.business.update({where:{id:f.business.id},data:{timezone:"Pacific/Honolulu"}});
 result=await read(f,{year:2027,month:1,asOf:new Date("2028-01-01Z")});assert.equal(result.annual.pendingCount,1);assert.equal(result.annual.complete,false);assert.equal(result.details.length,1);assert.equal(result.details[0].classification,"CAPTURED_PENDING");assert.equal(result.details[0].qualifiedCents,null);
});
test("annual details expose other-month gaps without repeating source checks; future annual targets aren't achieved",async()=>{
 const f=await fixture();await publish(f,{...f.draft,year:2027});const future=await read(f,{year:2027});assert.equal(future.annual.started,false);assert.equal(future.level.level,null);assert.equal(future.progress.percent,null);
 await cash(f,"118","2026-07-05Z");await cash(f);assert.equal((await read(f)).totalRows,1);const annual=await read(f,{detailRange:"year"});assert.equal(annual.totalRows,2);assert.equal(annual.annual.team.total,22000);
});

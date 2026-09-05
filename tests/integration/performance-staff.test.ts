import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { readStaffPerformance } from "../../src/lib/staff-pwa/performance";
import { readPerformanceLedger } from "../../src/lib/performance/read";
import { authenticateEmployeeSessionToken, createEmployeeSessionRecord } from "../../src/lib/attendance/employee-auth/session";
import { assertStaffTestDatabase, staffPerformanceFixture, staffCash, staffRefund, staffTargets, type StaffFixture } from "../helpers/performance-staff-fixture";

assertStaffTestDatabase();
process.env.EMPLOYEE_AUTH_SECRET = "phase3-isolated-employee-auth-secret-32-characters";
process.env.SESSION_SECRET = "phase3-isolated-target-signing-secret-32-characters";
process.env.TETAMU_PERFORMANCE_PHASE1 = "true"; process.env.TETAMU_PERFORMANCE_PHASE2 = "true"; process.env.TETAMU_STAFF_PERFORMANCE = "true";
const db = new PrismaClient(); after(() => db.$disconnect());
const read = (f: StaffFixture, index = 1, input: Record<string, unknown> = {}, asOf = new Date("2026-09-05T05:00Z")) => readStaffPerformance(f.sessions[index].context, { year: 2026, month: 8, view: "mine", ...input }, db, asOf);
const finances = async (f: StaffFixture) => JSON.stringify(await Promise.all([db.payment.findMany({ where: { businessId: f.business.id } }), db.paymentRefund.findMany({ where: { businessId: f.business.id } }), db.performanceContribution.findMany({ where: { businessId: f.business.id } }), db.performanceTargetVersion.findMany({ where: { businessId: f.business.id } })]), (_,v) => typeof v === "bigint" ? String(v) : v);

test("genuine Staff-only identity reads own RM118 split; tip-only recipient and minimal DTO", async () => {
  const f = await staffPerformanceFixture(db); await staffCash(db,f); await staffTargets(db,f);
  assert.equal(await db.user.count({where:{employeeBusinessMembershipId:f.members[1].id}}),0);
  const auth = await authenticateEmployeeSessionToken(f.sessions[1].token,{database:db,requireAttendance:false});
  assert.equal(auth.membershipId,f.members[1].id);
  const out = await read(f); assert.equal(out.personal.annual.total,5000); assert.equal(out.personal.goal,5000000); assert.equal(out.team.annual.total,11000);
  assert.equal(out.detail!.events[0].amount!.total,5000); assert.equal(out.detail!.events[0].amount!.tipsReceived,0);
  const tip = await read(f,2); assert.equal(tip.personal.annual.total,1000);assert.equal(tip.personal.annual.salesReceived,0);
  const serialized=JSON.stringify(out);for(const forbidden of [f.members[0].id,f.members[0].fullName,"phone","baseSalary","paymentId","actorUserId","attributionHistory","bank","permissions"])assert.ok(!serialized.includes(forbidden),forbidden);
  assert.ok(!("level" in out.personal));const card=await read(f,1,{view:"card"});assert.equal(card.detail,null);assert.ok(JSON.stringify(card).length<5000);
  const team=await read(f,1,{view:"team"});assert.equal(team.detail!.members.length,0);assert.equal(team.detail!.events.length,0);
});
test("explicit team grant, same-branch member view, revoked permission and backend boundary remain enforced",async()=>{
  const f=await staffPerformanceFixture(db);await staffCash(db,f);await staffTargets(db,f);
  const team=await read(f,0,{view:"auto"});assert.equal(team.mode,"team");assert.equal(team.detail!.members.length,7);
  const m=await read(f,0,{view:"member",member:f.members[1].id});assert.equal(m.detail!.subject.annual.total,5000);assert.equal(m.detail!.subject.goal,5000000);
  await db.user.update({where:{id:f.manager.id},data:{permissions:["APPROVE_LEAVE"]}});
  assert.equal((await read(f,0,{view:"auto"})).mode,"mine");await assert.rejects(read(f,0,{view:"member",member:f.members[1].id}),/SCOPE_DENIED/);
  await assert.rejects(readPerformanceLedger({...f.context,actorUserId:f.manager.id},{year:2026,asOf:new Date()},db),/permission/);
  await db.user.update({where:{id:f.manager.id},data:{permissions:["PERFORMANCE_VIEW_TEAM"],branchId:f.other.id}});
  assert.equal((await read(f,0)).canViewTeam,false);
});
test("spoofed tenant, branch, member, pagination and stale/revoked session cannot widen scope",async()=>{
  const f=await staffPerformanceFixture(db),g=await staffPerformanceFixture(db);
  for(const key of ["businessId","branchId","membershipId","actorUserId"])await assert.rejects(read(f,1,{[key]:g.members[0].id}));
  await assert.rejects(read(f,1,{view:"member",member:f.members[0].id}),/SCOPE_DENIED/);
  await assert.rejects(read(f,0,{view:"member",member:g.members[0].id,page:2}),/SCOPE_DENIED/);
  await assert.rejects(read(f,1,{page:-1}));
  await assert.rejects(readStaffPerformance({...f.sessions[1].context,membershipId:f.members[0].id},{},db),/session/i);
  await db.employeeDevice.update({where:{id:f.sessions[1].context.deviceId},data:{status:"REVOKED",revokedAt:new Date(),revokeReason:"Isolated revocation",canView:false,canPunch:false}});await assert.rejects(read(f),/session/i);
  await db.employeeSession.update({where:{id:f.sessions[0].context.sessionId},data:{revokedAt:new Date()}});await assert.rejects(read(f,0),/session/i);
});
test("complete YTD can exceed goal; no/zero goal never achieves; unknown sources suppress formal progress",async()=>{
  const f=await staffPerformanceFixture(db);await staffCash(db,f,{amount:"120000",memberIndex:1});
  let out=await read(f);assert.equal(out.personal.goal,null);assert.equal(out.personal.progress.percent,null);assert.equal(out.personal.annual.total,12000000);
  await staffTargets(db,f,{amounts:[{membershipId:f.members[1].id,amount:10000000}]});out=await read(f);assert.equal(out.personal.progress.percent,120);assert.equal(out.personal.progress.gap,-2000000);
  await staffCash(db,f,{amount:"600000",memberIndex:0});assert.equal((await read(f)).team.level,1);
  await staffTargets(db,f,{revision:1,amounts:[{membershipId:f.members[1].id,amount:0}]});assert.equal((await read(f)).personal.goal,null);
  await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,amount:10,method:"CASH",paidAt:new Date("2026-02-01Z")}});
  out=await read(f);assert.equal(out.team.complete,false);assert.equal(out.team.level,null);assert.equal(out.team.progress.percent,null);assert.equal(out.personal.complete,false);
});
test("unassigned stays in team; unknown/VOID not complete and private anomalies reveal no colleagues",async()=>{
  const f=await staffPerformanceFixture(db);const p=await staffCash(db,f);await staffCash(db,f,{unassigned:true});await staffTargets(db,f);
  let out=await read(f);assert.equal(out.team.annual.total,22000);assert.equal(out.team.unassigned.total,11000);assert.equal(out.team.complete,true);assert.equal(out.personal.attributionComplete,false);assert.equal(out.personal.progress.percent,null);
  await db.payment.update({where:{id:p.id},data:{status:"VOID"}});out=await read(f);assert.equal(out.team.complete,false);assert.equal(out.detail!.events[0].amount,null);assert.equal(out.team.annual.total,11000);
});
test("multi-store personal totals and goals stay stable on workplace change; manager sees member's own branch only",async()=>{
  const f=await staffPerformanceFixture(db);await staffCash(db,f);await staffTargets(db,f);
  await db.employeeBranchAssignment.create({data:{membershipId:f.members[1].id,businessId:f.business.id,branchId:f.other.id,canClockIn:false,effectiveFrom:new Date("2025-01-01Z")}});
  await staffCash(db,f,{branchId:f.other.id,amount:"200",memberIndex:1});
  let out=await read(f);assert.equal(out.personal.annual.total,25000);assert.equal(out.personal.goal,null);assert.equal(out.personal.knownTarget,5000000);assert.equal(out.detail!.branches.length,2);
  await staffTargets(db,f,{branchId:f.other.id,amounts:[{membershipId:f.members[1].id,amount:1000000}]});
  out=await read(f);assert.equal(out.personal.goal,6000000);
  const manager=await read(f,0,{view:"member",member:f.members[1].id});assert.equal(manager.detail!.subject.annual.total,5000);assert.equal(manager.detail!.subject.goal,5000000);assert.equal(manager.detail!.branches.length,0);
  const session=f.sessions[1];await db.employeeSession.update({where:{id:session.context.sessionId},data:{attendanceBranchId:f.other.id}});
  await assert.rejects(read(f),/session/i);
  const changed=await readStaffPerformance({...session.context,attendanceBranchId:f.other.id},{view:"mine",year:2026,month:8},db);
  assert.equal(changed.personal.annual.total,25000);assert.equal(changed.personal.goal,6000000);assert.equal(changed.team.annual.total,20000);assert.notEqual(changed.scopeKey,out.scopeKey);
});
test("terminated contributor retained; independent tips and cross-year refunds produce negative net without truncation",async()=>{
  const f=await staffPerformanceFixture(db);const p=await staffCash(db,f,{at:"2025-12-01T04:00Z"});await staffRefund(db,f,p.id,118,"2026-01-02T04:00Z");
  let out=await read(f,2,{month:1},new Date("2026-01-05T04:00Z"));assert.equal(out.personal.annual.total,-1000);assert.equal(out.personal.previous.total,1000);assert.equal(out.personal.comparison.delta,-2000);assert.equal(out.personal.comparison.percent,-200);
  assert.equal(out.detail!.months[1].future,true);assert.equal(out.personal.annual.tipsRefunds,1000);
  await db.employeeBusinessMembership.update({where:{id:f.members[2].id},data:{status:"TERMINATED"}});
  out=await read(f,0,{view:"team",month:1});assert.equal(out.detail!.members.find(m=>m.id===f.members[2].id)!.status,"TERMINATED");assert.equal(out.team.annual.total,-11000);
});
test("comparison clips prior month, handles zero/negative base and incomplete comparison; operating not attendance timezone",async()=>{
  const f=await staffPerformanceFixture(db);await staffCash(db,f,{at:"2026-03-30T16:00Z"});
  let out=await read(f,1,{month:3},new Date("2026-03-31T05:22Z"));assert.equal(out.timezone,"Asia/Kuching");assert.equal(out.personal.comparison.previousTo,"2026-02-28T15:59:59.999Z");assert.equal(out.personal.comparison.percent,null);
  assert.equal(out.personal.comparison.ongoing,true);assert.equal(out.personal.current.total,5000);
  await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,amount:10,method:"CASH",paidAt:new Date("2026-02-01Z")}});
  out=await read(f,1,{month:3},new Date("2026-03-31T05:22Z"));assert.equal(out.personal.comparison.complete,false);assert.equal(out.personal.comparison.percent,null);
});
test("paging is private and conserved; one source scan per branch, not members times months; readonly financial state",async()=>{
  const f=await staffPerformanceFixture(db);for(let i=0;i<22;i++)await staffCash(db,f);await staffTargets(db,f);
  const before=await finances(f);let scans=0;
  const extended=db.$extends({query:{payment:{async findMany({args,query}){scans++;return query(args);}}}}) as unknown as PrismaClient;
  const out=await readStaffPerformance(f.sessions[1].context,{view:"mine",year:2026,month:8},extended);assert.equal(scans,1);assert.equal(out.detail!.events.length,20);assert.equal(out.detail!.totalRows,22);assert.equal(out.personal.annual.total,110000);
  const page2=await read(f,1,{page:2});assert.equal(page2.detail!.events.length,2);assert.equal(page2.personal.annual.total,110000);assert.equal(new Set([...out.detail!.events,...page2.detail!.events].map(e=>e.id)).size,22);
  assert.equal(await finances(f),before);
});
test("disabled stops before any performance query; no transactions is genuine complete zero; capture flag gaps survive reenabling",async()=>{
  const f=await staffPerformanceFixture(db);let out=await read(f);assert.equal(out.team.complete,true);assert.equal(out.personal.annual.total,0);
  process.env.TETAMU_STAFF_PERFORMANCE="false";
  try{const fail=db.$extends({query:{$allModels:{$allOperations(){throw new Error("Unexpected DB read");}}}}) as unknown as PrismaClient;await assert.rejects(readStaffPerformance(f.sessions[1].context,{},fail),/PERFORMANCE_DISABLED/);}finally{process.env.TETAMU_STAFF_PERFORMANCE="true";}
  process.env.TETAMU_PERFORMANCE_PHASE1="false";try{await staffCash(db,f);}finally{process.env.TETAMU_PERFORMANCE_PHASE1="true";}
  out=await read(f);assert.equal(out.team.complete,false);assert.equal(out.team.annual.total,0);assert.equal(out.team.progress.percent,null);
});
test("primary self-service works without attendance/Payroll; new session identity gets a different response binding",async()=>{
  const f=await staffPerformanceFixture(db);assert.equal(f.members[1].attendanceEnabled,false);
  const old=await read(f),a=f.sessions[1].context;
  const next=await db.$transaction(tx=>createEmployeeSessionRecord({...a,now:new Date()},tx));
  const out=await readStaffPerformance(next.context,{view:"card"},db);assert.notEqual(out.scopeKey,old.scopeKey);
});

test("January comparison includes prior-store December without inflating this year's goal or personal scope",async()=>{
  const f=await staffPerformanceFixture(db);
  await db.employeeBranchAssignment.updateMany({where:{membershipId:f.members[1].id,branchId:f.branch.id},data:{effectiveFrom:new Date("2026-01-01Z")}});
  await db.employeeBranchAssignment.create({data:{membershipId:f.members[1].id,businessId:f.business.id,branchId:f.other.id,effectiveFrom:new Date("2025-01-01Z"),effectiveUntil:new Date("2025-12-31T15:59:59Z"),canClockIn:false}});
  await staffCash(db,f,{at:"2025-12-01T04:00Z",branchId:f.other.id,amount:"200",memberIndex:1});await staffTargets(db,f);
  const out=await read(f,1,{month:1},new Date("2026-01-15T04:00Z"));assert.equal(out.personalBranchCount,1);assert.equal(out.personal.goal,5000000);assert.equal(out.personal.annual.total,0);assert.equal(out.personal.previous.total,20000);assert.equal(out.personal.comparison.delta,-20000);
  assert.equal(out.detail!.branches.length,1);
});
test("Staff summary and source coverage share one repeatable read snapshot under concurrent receipt insertion",async()=>{
  const f=await staffPerformanceFixture(db);let inserted=false;
  const concurrent=db.$extends({query:{payment:{async findMany({args,query}){
    if(!inserted){inserted=true;await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,amount:9,method:"CASH",paidAt:new Date("2026-01-01T04:00Z")}});}
    return query(args);
  }}}}) as unknown as PrismaClient;
  const first=await readStaffPerformance(f.sessions[1].context,{view:"card",year:2026},concurrent);
  assert.equal(first.team.complete,true);assert.equal(first.team.annual.total,0);assert.equal((await read(f)).team.complete,false);
});

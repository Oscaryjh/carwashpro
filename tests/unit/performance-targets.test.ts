import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEFAULT_LEVELS, equalTargets, targetGap, targetDraftSchema, parseTargetAmount, progress, teamLevel, comparePerformance } from "../../src/lib/performance/targets-contract";
import { comparisonWindow } from "../../src/lib/performance/dashboard";
import { getStaffHomePath, routePermission, normalizeStaffPermissions } from "../../src/lib/auth/staff-permissions";
import { modulesForCapability, modulesForStaffPermission } from "../../src/lib/modules/registry";

test("600000 / 800000 / 1000000 cumulative levels; manager 300000 + six 50000",()=>{
  const manager=randomUUID(),people=equalTargets(DEFAULT_LEVELS[0],30_000_000,manager,Array.from({length:6},()=>randomUUID()));
  assert.deepEqual(DEFAULT_LEVELS,[60000000,80000000,100000000]);assert.equal(people.length,7);assert.equal(targetGap(DEFAULT_LEVELS[0],people),0);assert.ok(people.slice(1).every(p=>p.amount===5000000));
  assert.equal(teamLevel(80000000,DEFAULT_LEVELS,true).level,2);assert.equal(people[0].amount,30000000);
});
test("deterministic cent remainder, no duplicate manager or negative/empty allocation",()=>{
  assert.deepEqual(equalTargets(104,3,"m",["b","a","c","m","b"]),[{membershipId:"m",amount:3},{membershipId:"a",amount:34},{membershipId:"b",amount:34},{membershipId:"c",amount:33}]);
  assert.throws(()=>equalTargets(100,101,"m",["a"]));assert.throws(()=>equalTargets(100,10,"m",[]));assert.throws(()=>equalTargets(100,10,"",["a"]));
  assert.equal(parseTargetAmount("600000.01"),60000001);assert.throws(()=>parseTargetAmount("1.001"));
});
test("strict ascending levels, duplicate identities, zero personal target, explicit gap contract",()=>{
  const id=randomUUID(),draft={year:2026,levels:DEFAULT_LEVELS,managerId:id,people:[{membershipId:id,amount:0}],expectedRevision:0,reason:"Initial annual targets",confirmGap:false};
  assert.equal(targetDraftSchema.parse(draft).people[0].amount,0);
  assert.equal(progress(100,0,true).state,"NO_TARGET");assert.equal(progress(100,0,true).percent,null);
  assert.throws(()=>targetDraftSchema.parse({...draft,levels:[100,100,200]}));assert.throws(()=>targetDraftSchema.parse({...draft,people:[...draft.people,...draft.people]}));
  assert.equal(targetGap(10,[{amount:11}]),-1);
});
test("midyear complete confirms level, missing coverage suppresses; refund can downgrade",()=>{
  assert.equal(progress(60000000,60000000,true).percent,100);assert.equal(teamLevel(60000000,DEFAULT_LEVELS,true).level,1);
  assert.equal(teamLevel(60000000,DEFAULT_LEVELS,false).level,null);assert.equal(progress(60000000,60000000,false).percent,null);
  assert.equal(teamLevel(59999999,DEFAULT_LEVELS,true).level,0);
});
test("zero / negative baseline never Infinity, incomplete comparison not confirmed",()=>{
  assert.deepEqual(comparePerformance(100,0,true),{delta:100,percent:null,complete:true});assert.equal(comparePerformance(100,-50,true).percent,null);
  assert.equal(comparePerformance(200,100,false).percent,null);assert.equal(comparePerformance(200,100,true).percent,100);
});
test("current month matched time uses operating midnight and exact seconds; shorter month clamps",()=>{
  const at=new Date("2026-03-15T04:23:45.123Z"),w=comparisonWindow(2026,3,"Asia/Kuching",at);
  assert.equal(w.previousAsOf.toISOString(),"2026-02-15T04:23:45.123Z");assert.equal(w.label,"上月同期");
  assert.equal(w.current.from.toISOString(),"2026-02-28T16:00:00.000Z");
  assert.equal(comparisonWindow(2026,3,"Asia/Kuching",new Date("2026-03-31T04:00Z")).previousAsOf.toISOString(),"2026-02-28T15:59:59.999Z");
});
test("closed month vs full month, January vs prior December, future month",()=>{
  const w=comparisonWindow(2026,8,"Asia/Kuching",new Date("2026-09-05Z"));assert.equal(w.label,"上月整月");assert.equal(w.previousAsOf.toISOString(),"2026-07-31T15:59:59.999Z");
  const jan=comparisonWindow(2026,1,"Asia/Kuching",new Date("2026-01-10T02:00Z"));assert.equal(jan.previous.from.toISOString(),"2025-11-30T16:00:00.000Z");
  assert.equal(comparisonWindow(2026,12,"Asia/Kuching",new Date("2026-09-05Z")).future,true);
});
test("independent performance login route and capabilities never imply TEAM or Payroll",()=>{
 process.env.TETAMU_PERFORMANCE_PHASE2="true";
 try {
  assert.equal(getStaffHomePath(["PERFORMANCE_VIEW_TEAM"]),"/team/performance");assert.equal(getStaffHomePath(["PERFORMANCE_MANAGE_TARGETS"]),"/team/performance");
  assert.equal(routePermission("/team/performance"),null);assert.equal(routePermission("/team"),"TEAM");
  assert.deepEqual(normalizeStaffPermissions(["PERFORMANCE_MANAGE_TARGETS"]),["PERFORMANCE_MANAGE_TARGETS"]);
  assert.deepEqual(modulesForCapability("PERFORMANCE_VIEW_TEAM","SALON_BEAUTY"),[]);assert.deepEqual(modulesForStaffPermission("PERFORMANCE_MANAGE_TARGETS","SALON_BEAUTY"),[]);
 } finally {delete process.env.TETAMU_PERFORMANCE_PHASE2;}
 assert.equal(getStaffHomePath(["PERFORMANCE_VIEW_TEAM"]),"/login");
});

import assert from "node:assert/strict";
import test, {after} from "node:test";
import {PrismaClient} from "@prisma/client";
import {reportFixture} from "../helpers/report-outlet-fixture";
import {reportOutletModule} from "../helpers/report-outlet-import";
import {getBusinessPerformanceReadModel} from "../../src/lib/business-performance/read-model";
import {getDailySalesReport} from "../../src/lib/reports/daily-sales";
import {getBusinessDayRange} from "../../src/lib/business-day";
import {capturePerformanceCheckout,capturePerformanceRefund} from "../../src/lib/performance/service";
import {readPerformanceDashboard} from "../../src/lib/performance/dashboard";

const url=new URL(process.env.DATABASE_URL!);
if(url.hostname!=="127.0.0.1"||url.port!=="55444"||!url.pathname.startsWith("/tetamu_phase1c1_disposable_"))throw Error("Independent disposable DB required");
const db=new PrismaClient();after(()=>db.$disconnect());

test("actual current queries exclude inactive revenue and stock, retain business catalog and mixed Expense",async()=>{
  const f=await reportFixture(db),other=await reportFixture(db);
  const {resolveReportOutletScope}=await reportOutletModule();
  const scope=await resolveReportOutletScope({businessId:f.business.id,actorUserId:f.owner.id,surface:"dashboard"},db);
  assert.equal(scope.kind,"ready");if(scope.kind!=="ready"||scope.selection.kind!=="branch")throw Error("current branch required");
  const result=await getBusinessPerformanceReadModel({businessId:f.business.id,allowedBranchIds:[scope.selection.branchId],selectedBranchId:scope.selection.branchId,includeBusinessWide:scope.businessScopeAllowed,expenseScope:scope.expenseScope,salonAccess:{access:scope.access,requestedBranchId:scope.selection.branchId},range:"custom",from:"2026-10-10",to:"2026-10-10"});
  assert.equal(result.sales?.netSalesCents,100000);
  assert.equal(result.businessSpending?.recorded,"50.00");
  assert.equal(result.businessSpending?.incomeVsRecordedSpending,"950.00");
  assert.equal(result.inventory?.trackedProducts,2);
  assert.equal(result.inventory?.sellingValue,"300.00");
  const daily=await getDailySalesReport({businessId:f.business.id,branchId:f.branches[0].id,range:getBusinessDayRange({fromDateValue:"2026-10-10",toDateValue:"2026-10-10",timezone:"Asia/Singapore",businessDayCutoffTime:"02:00"})});
  assert.equal(daily.summary.netSalesCents,100000);
  for(const surface of ["dashboard","reports","performance"] as const) {
    assert.equal((await resolveReportOutletScope({businessId:f.business.id,actorUserId:f.owner.id,surface,explicitBranchInput:other.branches[0].id},db)).kind,"denied");
  }
  const history=await resolveReportOutletScope({businessId:f.business.id,actorUserId:f.owner.id,surface:"performance",explicitBranchInput:f.historical.id},db);
  assert.equal(history.kind,"ready");if(history.kind==="ready")assert.deepEqual(history.selection,{kind:"branch",branchId:f.historical.id});
});

test("real request freshness: legacy one-visible Staff, revoke, topology change and zero current",async()=>{
  const {resolveReportOutletScope}=await reportOutletModule();
  const f=await reportFixture(db,2),zero=await reportFixture(db,0);
  for(const surface of ["dashboard","reports","performance"] as const) {
    const input={businessId:f.business.id,actorUserId:f.staff.id,surface};
    const scope=await resolveReportOutletScope(input,db);
    assert.equal(scope.kind,"ready");if(scope.kind==="ready"){assert.equal(scope.topologyMode,"legacy_multi_branch");assert.deepEqual(scope.branches.map(b=>b.id),[f.branches[0].id]);}
    assert.equal((await resolveReportOutletScope({...input,explicitBranchInput:f.branches[1].id},db)).kind,"denied");
    assert.equal((await resolveReportOutletScope({businessId:zero.business.id,actorUserId:zero.owner.id,surface},db)).kind,"no_location");
  }
  await db.user.update({where:{id:f.staff.id},data:{permissions:[]}});
  assert.equal((await resolveReportOutletScope({businessId:f.business.id,actorUserId:f.staff.id,surface:"dashboard"},db)).kind,"denied");
  const single=await reportFixture(db);
  const input={businessId:single.business.id,actorUserId:single.owner.id,surface:"dashboard" as const};
  await resolveReportOutletScope(input,db);
  await db.branch.create({data:{businessId:single.business.id,name:"New current"}});
  const changed=await resolveReportOutletScope(input,db);
  assert.equal(changed.kind,"ready");if(changed.kind==="ready")assert.equal(changed.topologyMode,"legacy_multi_branch");
});

test("actual captured Performance and refund preserve current versus inactive attribution",async()=>{
  process.env.TETAMU_PERFORMANCE_PHASE1="true";
  process.env.TETAMU_PERFORMANCE_PHASE2="true";
  const f=await reportFixture(db);
  const payments=await db.payment.findMany({where:{businessId:f.business.id}});
  for(const payment of payments) await db.$transaction(tx=>capturePerformanceCheckout(tx,{businessId:f.business.id,actorUserId:f.owner.id,paymentIds:[payment.id],input:null}));
  const current=payments.find(p=>p.branchId===f.branches[0].id)!;
  await db.$transaction(async tx=>{
    const refund=await tx.paymentRefund.create({data:{businessId:f.business.id,branchId:f.branches[0].id,paymentId:current.id,invoiceId:current.invoiceId,amount:10,method:"CASH",reason:"Disposable scope verification",refundedAt:new Date("2026-10-10T05:00Z")}});
    await capturePerformanceRefund(tx,refund.id,{businessId:f.business.id,actorUserId:f.owner.id});
  });
  for(const [branch,quantity] of [[f.branches[0],12],[f.historical,99]] as const) await db.inventoryMovement.create({data:{businessId:f.business.id,branchId:branch.id,productId:f.product.id,actorUserId:f.owner.id,type:"OPENING_BALANCE",quantityDelta:quantity,quantityBefore:0,quantityAfter:quantity,sourceType:"DISPOSABLE_FIXTURE",sourceId:f.product.id,operationKey:`fixture-${branch.id}`,reason:"Synthetic initial state"}});
  const {resolveReportOutletScope}=await reportOutletModule();
  for(const [branch,expected,historical] of [[f.branches[0],99000,false],[f.historical,50000,true]] as const){
    const scope=await resolveReportOutletScope({businessId:f.business.id,actorUserId:f.owner.id,surface:"performance",...(historical?{explicitBranchInput:branch.id}:{})},db);
    assert.equal(scope.kind,"ready");if(scope.kind!=="ready"||scope.selection.kind!=="branch")throw Error("branch required");
    assert.equal(scope.selection.branchId,branch.id);
    const result=await readPerformanceDashboard({businessId:f.business.id,branchId:scope.selection.branchId,actorUserId:f.owner.id},{year:2026,month:10,asOf:new Date("2026-10-11T04:00Z")},db);
    assert.equal(result.annual.team.total,expected);
    assert.equal(result.annual.team.refunds,historical?0:1000);
    assert.equal(await db.inventoryMovement.count({where:{businessId:f.business.id,branchId:branch.id}}),1);
  }
});

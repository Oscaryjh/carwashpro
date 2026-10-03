import assert from "node:assert/strict";
import test, {after} from "node:test";
import {walletFixture,walletTestDatabase} from "../helpers/wallet-fixture";
import {getDailyClosingReadiness} from "../../src/lib/closing/readiness";
import { randomUUID } from "node:crypto";
import { createClosingActionsFixture, closingForm, actionRedirect } from "../helpers/closing-actions-fixture";
const db=walletTestDatabase();after(()=>db.$disconnect());
test("readiness uses real branch facts, cutoff and cross-day safety without writing",async()=>{const f=await walletFixture(db);await db.business.update({where:{id:f.business.id},data:{timezone:"Asia/Kuching",businessDayCutoffTime:"02:00"}});await db.cashierShift.update({where:{id:f.shift.id},data:{startedAt:new Date("2026-10-02T03:00Z"),endedAt:new Date("2026-10-02T04:00Z"),status:"CLOSED"}});const input={businessId:f.business.id,branchId:f.branch.id,authorizedBranchIds:[f.branch.id],dateValue:"2026-10-02",settings:{timezone:"Asia/Kuching",businessDayCutoffTime:"02:00"},now:new Date("2026-10-02T07:00Z")};const facts=()=>db.cashierShift.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}});const before=JSON.stringify(await facts());assert.deepEqual(await getDailyClosingReadiness(input,db),{status:"READY",businessDate:"2026-10-02",isCurrentBusinessDate:true,shiftCount:1});assert.equal(JSON.stringify(await facts()),before);assert.equal((await getDailyClosingReadiness({...input,now:new Date("2026-10-01T17:00Z")},db)).status,"FUTURE_DATE");assert.deepEqual(await getDailyClosingReadiness({...input,now:new Date("2026-10-03T07:00Z")},db),{status:"READY",businessDate:"2026-10-02",isCurrentBusinessDate:false,shiftCount:1});await db.cashierShift.update({where:{id:f.shift.id},data:{endedAt:new Date("2026-10-03T07:00Z")}});assert.equal((await getDailyClosingReadiness(input,db)).status,"BLOCKED_REVIEW");await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN",startedAt:new Date("2026-10-01T03:00Z"),endedAt:null}});assert.equal((await getDailyClosingReadiness(input,db)).status,"BLOCKED_OPEN");assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);assert.equal(await db.notificationQueue.count({where:{businessId:f.business.id}}),0);});

for(const activity of ["payment","refund","payout"] as const)test(`readiness delegates real out-of-range ${activity} to canonical cross-day guard`,async()=>{
 const f=await walletFixture(db);
 const startedAt=new Date("2026-10-02T03:00:00Z"),endedAt=new Date("2026-10-02T04:00:00Z"),unsafe=new Date("2026-10-02T18:00:00Z");
 await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED",startedAt,endedAt}});
 const input={businessId:f.business.id,branchId:f.branch.id,authorizedBranchIds:[f.branch.id],dateValue:"2026-10-02",settings:{timezone:"Asia/Kuching",businessDayCutoffTime:"02:00"},now:new Date("2026-10-03T07:00:00Z")};
 assert.equal((await getDailyClosingReadiness(input,db)).status,"READY");
 if(activity!=="payout"){
  const payment=await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,shiftId:f.shift.id,amount:1,method:"CASH",paidAt:activity==="payment"?unsafe:startedAt}});
  if(activity==="refund")await db.paymentRefund.create({data:{businessId:f.business.id,branchId:f.branch.id,shiftId:f.shift.id,paymentId:payment.id,amount:1,method:"CASH",reason:"Synthetic crossing",refundedAt:unsafe}});
 }else{
  const category=await db.expenseCategory.create({data:{businessId:f.business.id,name:"Synthetic crossing"}});
  const expense=await db.businessExpense.create({data:{businessId:f.business.id,branchId:f.branch.id,expenseNumber:"SYNTHETIC",categoryId:category.id,categoryNameSnapshot:category.name,expenseDate:startedAt,amount:1,description:"Synthetic crossing",createdById:f.actor.id}});
  const event=await db.businessExpensePaymentEvent.create({data:{businessId:f.business.id,expenseId:expense.id,paymentStatus:"PAID",paymentMethod:"CASH",paymentDate:startedAt,actorUserId:f.actor.id,amount:1,paymentSource:"POS_DRAWER"}});
  await db.cashierShiftExpensePayout.create({data:{businessId:f.business.id,branchId:f.branch.id,shiftId:f.shift.id,paymentEventId:event.id,amount:1,createdById:f.actor.id,occurredAt:unsafe}});
 }
 const checkpoint=JSON.stringify(await db.cashierShift.findUnique({where:{id:f.shift.id}}));
 assert.equal((await getDailyClosingReadiness(input,db)).status,"BLOCKED_REVIEW");
 assert.equal(JSON.stringify(await db.cashierShift.findUnique({where:{id:f.shift.id}})),checkpoint);
 assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);
});

test("actual stale resolution closes only shift and old-date readiness still requires review",async()=>{
 const f=await walletFixture(db);await db.user.update({where:{id:f.actor.id},data:{email:`${randomUUID()}@example.test`}});
 const startedAt=new Date(Date.now()-3*86400000);await db.cashierShift.update({where:{id:f.shift.id},data:{startedAt}});
 const h=await createClosingActionsFixture(db);try{
  await h.login(f.actor.id);await actionRedirect(h.actions.resolveStaleShiftAction(closingForm({shiftId:f.shift.id,countedCash:"0",reason:"Synthetic review"})));
  assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}})).status,"CLOSED");
  const {getCurrentBusinessDateValue}=await import("../../src/lib/business-day");
  assert.equal((await getDailyClosingReadiness({businessId:f.business.id,branchId:f.branch.id,authorizedBranchIds:[f.branch.id],dateValue:getCurrentBusinessDateValue(startedAt,f.business.timezone,f.business.businessDayCutoffTime),settings:f.business},db)).status,"BLOCKED_REVIEW");
  assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);
 }finally{await h.close()}
});

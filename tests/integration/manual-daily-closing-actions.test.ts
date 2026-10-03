import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { createClosingActionsFixture, closingForm, actionRedirect } from "../helpers/closing-actions-fixture";
import { getCurrentBusinessDateValue } from "../../src/lib/business-day";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
const db=walletTestDatabase(); after(()=>db.$disconnect());

test("old authenticated Closing settings and resend actions reject without writes",async()=>{
 const f=await setup();try{
  await db.businessModuleEntitlement.create({data:{businessId:f.business.id,moduleKey:"WHATSAPP",status:"ENABLED",enabledFrom:new Date(0),source:"MANUAL"}});
  const before=await db.auditLog.count({where:{businessId:f.business.id}});
  const results=await Promise.allSettled([
   f.h.actions.manualClosingWhatsAppSendAction(closingForm({attemptId:randomUUID(),trigger:"MANUAL_RETRY",reason:"Historical"})),
   f.h.actions.saveClosingWhatsAppAutomationSettingsAction(closingForm({language:"EN",deadlineTime:"22:00",closingEnabled:"on"})),
  ]);
  for(const result of results){assert.equal(result.status,"rejected");if(result.status==="rejected")assert.match(result.reason.message,/Daily closing has been retired/);}
  assert.equal(await db.closingWhatsAppSetting.count({where:{businessId:f.business.id}}),0);
  assert.equal(await db.auditLog.count({where:{businessId:f.business.id}}),before);
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
 }finally{await f.h.close()}
});

async function setup() { const f=await walletFixture(db); await db.user.update({where:{id:f.actor.id},data:{email:`${randomUUID()}@example.test`}}); const h=await createClosingActionsFixture(db); await h.login(f.actor.id); return {...f,h}; }
async function dailyCounts(businessId:string) { return Promise.all([db.dailyClosingSnapshot.count({where:{businessId}}),db.auditLog.count({where:{businessId,action:"DAILY_CLOSING_CONFIRMED"}}),db.notificationQueue.count({where:{businessId}}),db.financialOperation.count({where:{businessId,operationType:"DAILY_CLOSING"}})]); }

test("authenticated A End then B Start and End never closes day; retired confirm never freezes it",async()=>{
 const f=await setup(); try{
  const end=()=>actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})));
  const ended=decodeURIComponent(await end());
  assert.match(ended,/Shift ended/);
  assert.doesNotMatch(ended,/daily closing|separate confirmation/i);
  assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}})).status,"CLOSED");
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
  const b=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,name:"B",email:`${randomUUID()}@example.test`,role:"STAFF",permissions:["CLOSING","CONFIRM_DAILY_CLOSING"]}});await f.h.login(b.id);
  assert.match(await actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"50"}))),/success/);
  const shift=await db.cashierShift.findFirstOrThrow({where:{businessId:f.business.id,cashierId:b.id,status:"OPEN"}});
  await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:shift.id,closingCash:"50"})));
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
  const businessDate=getCurrentBusinessDateValue(new Date(),f.business.timezone,f.business.businessDayCutoffTime);
  const form=closingForm({branchId:f.branch.id,businessDate,actualCash:"0",operationId:randomUUID()});
  for (const candidate of [form, form, closingForm({})]) {
   const result=await f.h.actions.closeDailySnapshotAction({status:"idle",message:""},candidate);
   assert.equal(result.status,"error");assert.match(result.message,/Daily closing has been retired/);
   assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
  }
  assert.match(await actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"0"}))),/success/);
 }finally{await f.h.close()}
});

test("CLOSING-only staff cannot confirm and cannot end another cashier's shift",async()=>{const f=await setup();try{const u=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,name:"Staff",email:`${randomUUID()}@example.test`,role:"STAFF",permissions:["CLOSING"]}});await f.h.login(u.id);assert.match(decodeURIComponent(await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})))),/Open shift not found/);const r=await f.h.actions.closeDailySnapshotAction({status:"idle",message:""},closingForm({}));assert.equal(r.status,"error");assert.match(r.message,/permission/);assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);}finally{await f.h.close()}});

test("first and last authenticated cashier End never enqueue; retired confirm preserves wallet money without enqueue",async()=>{
 const f=await setup();try{
  await postWalletTopUp(f.ctx,f.input,db);
  await db.closingWhatsAppSetting.create({data:{businessId:f.business.id,enabled:true}});
  await db.closingWhatsAppRecipient.create({data:{businessId:f.business.id,role:"OWNER",label:"Synthetic",phone:"+60112345678",normalizedPhone:"+60112345678"}});
  const u=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,name:"B",email:`${randomUUID()}@example.test`,role:"STAFF",permissions:["CLOSING","CONFIRM_DAILY_CLOSING"]}});
  await f.h.login(u.id);await actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"50"})));
  const b=await db.cashierShift.findFirstOrThrow({where:{businessId:f.business.id,cashierId:u.id,status:"OPEN"}});
  const facts=async()=>JSON.stringify(await Promise.all([db.payment.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.walletAccount.findMany({where:{businessId:f.business.id}}),db.walletTransaction.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.invoice.findMany({where:{businessId:f.business.id}}),db.paymentRefund.findMany({where:{businessId:f.business.id}}),db.performanceReceipt.findMany({where:{businessId:f.business.id}}),db.performanceContribution.findMany({where:{businessId:f.business.id}})]));
  const before=await facts();await f.h.login(f.actor.id);
  await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"1000"})));
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
  await f.h.login(u.id);await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:b.id,closingCash:"50"})));
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);assert.equal(await facts(),before);
  const businessDate=getCurrentBusinessDateValue(new Date(),f.business.timezone,f.business.businessDayCutoffTime);
  const form=closingForm({branchId:f.branch.id,businessDate,actualCash:"1000",operationId:randomUUID()});
  const r=await f.h.actions.closeDailySnapshotAction({status:"idle",message:""},form);
  assert.equal(r.status,"error");assert.match(r.message,/retired/);
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);assert.equal(await facts(),before);
 }finally{await f.h.close()}
});

test("cash difference needs reason, duplicate end does not audit twice, stale resolution never freezes",async()=>{const f=await setup();try{
 const wrong=await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"10"})));assert.match(decodeURIComponent(wrong),/note/);assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}})).status,"OPEN");
 await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"10",notes:"Synthetic over"})));const row=await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}});assert.equal(Number(row.cashDifference),10);assert.equal(row.notes,"Synthetic over");
 await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"10",notes:"Synthetic over"})));assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:"SHIFT_ENDED"}}),1);
 const old=await db.cashierShift.create({data:{businessId:f.business.id,branchId:f.branch.id,cashierId:f.actor.id,startedAt:new Date(Date.now()-3*86400000)}});
 await actionRedirect(f.h.actions.resolveStaleShiftAction(closingForm({shiftId:old.id,countedCash:"0",reason:"Synthetic stale"})));assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:old.id}})).status,"CLOSED");assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:"STALE_SHIFT_RESOLVED"}}),1);assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
}finally{await f.h.close()}});

test("End denies missing CLOSING and foreign tenant; yesterday missing snapshot does not block new Start",async()=>{
 const f=await setup();try{
  const noClosing=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,name:"No closing",email:`${randomUUID()}@example.test`,role:"STAFF",permissions:["CRM"]}});
  const noClosingShift=await db.cashierShift.create({data:{businessId:f.business.id,branchId:f.branch.id,cashierId:noClosing.id}});
  await f.h.login(noClosing.id);const denied=await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:noClosingShift.id,closingCash:"0"})));assert.doesNotMatch(denied,/success/);
  assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:noClosingShift.id}})).status,"OPEN");assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:"SHIFT_ENDED"}}),0);
  const foreign=await walletFixture(db);await db.user.update({where:{id:foreign.actor.id},data:{email:`${randomUUID()}@example.test`}});await f.h.login(foreign.actor.id);
  assert.match(decodeURIComponent(await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})))),/Open shift not found/);
  assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}})).status,"OPEN");
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED",startedAt:new Date(Date.now()-3*86400000),endedAt:new Date(Date.now()-3*86400000+3600000)}});
  await f.h.login(f.actor.id);assert.match(await actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"0"}))),/success/);
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
 }finally{await f.h.close()}
});

test("real Start and retired Confirm race always permits Start without snapshot",async()=>{
 for(let attempt=0;attempt<3;attempt++){
  const f=await setup();try{
   await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})));
   const businessDate=getCurrentBusinessDateValue(new Date(),f.business.timezone,f.business.businessDayCutoffTime);
   await Promise.all([
    actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"0"}))),
    f.h.actions.closeDailySnapshotAction({status:"idle",message:""},closingForm({branchId:f.branch.id,businessDate,actualCash:"0",operationId:randomUUID()})),
   ]);
   const [snapshots,open]=await Promise.all([db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),db.cashierShift.count({where:{businessId:f.business.id,status:"OPEN"}})]);
   assert.equal(snapshots,0);assert.equal(open,1,`attempt ${attempt}: Start succeeds`);
  }finally{await f.h.close()}
 }
});

test("failed SHIFT_ENDED audit rolls back shift update and produces no daily side effects",async()=>{
 const f=await setup();await f.h.close();
 const failing=db.$extends({query:{auditLog:{async create({args,query}){const row=await query(args);if(args.data.action==="SHIFT_ENDED")throw Error("INJECTED_SHIFT_AUDIT_FAILURE");return row;}}}}) as unknown as typeof db;
 const h=await createClosingActionsFixture(failing);try{
  await h.login(f.actor.id);const before=await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}});
  await actionRedirect(h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})));
  assert.deepEqual(await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}}),before);
  assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:"SHIFT_ENDED"}}),0);
  assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
 }finally{await h.close()}
});

test("real Cash Card Wallet mixed sale and refund facts stay byte-stable across End and manual Confirm",async()=>{
 const previousPerformance=process.env.TETAMU_PERFORMANCE_PHASE1;process.env.TETAMU_PERFORMANCE_PHASE1="true";
 const f=await setup();const h=await checkoutHarness(db);try{
  await postWalletTopUp(f.ctx,f.input,db);await h.login(db,f);
  const product=await db.product.create({data:{businessId:f.business.id,name:"Synthetic closing invariance",price:80}});
  for(const [method,walletAmount] of [["CASH","0"],["CARD","0"],["MEMBER_WALLET","80"],["CARD","40"]]){
   const result=await h.action.completeCashierSaleAction(closingForm({modeAtConfirmation:"ON",shiftId:f.shift.id,operationId:randomUUID(),branchId:f.branch.id,customerId:f.customer.id,productId:product.id,productQuantity:"1",method,walletAmount,paymentMethodCode:method==="MEMBER_WALLET"?method:`BUILTIN_${method}`,...(method!=="MEMBER_WALLET"?{reference:"Synthetic only"}:{})}));
   assert.equal(result.status,"success",result.message);
  }
  const wallet=await db.payment.findFirstOrThrow({where:{businessId:f.business.id,method:"MEMBER_WALLET",amount:80}});
  await refundWalletSale(f.ctx,{operationKey:randomUUID(),invoiceId:wallet.invoiceId!,reason:"Synthetic closing invariance",stockLines:[],legs:[{paymentId:wallet.id,amountCents:8000,method:"MEMBER_WALLET"}]},db);
  const where={businessId:f.business.id};const orderBy={id:"asc" as const};
  const facts=async()=>Promise.all([db.walletAccount.findMany({where,orderBy}),db.walletTransaction.findMany({where,orderBy}),db.payment.findMany({where,orderBy}),db.invoice.findMany({where,orderBy}),db.paymentRefund.findMany({where,orderBy}),db.performanceReceipt.findMany({where,orderBy}),db.performanceContribution.findMany({where,orderBy}),db.loyaltyTransaction.findMany({where,orderBy}),db.customerMembership.findMany({where,orderBy})]);
  const before=await facts();for(const rows of before.slice(0,7))assert.ok(rows.length>0,"invariance fixture must contain actual financial facts");
  const canonical=(value:unknown)=>createHash("sha256").update(JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v)).digest("hex");
  const checkpoint=canonical(before);await f.h.login(f.actor.id);
  await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"1080"})));
  assert.equal((await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}})).status,"CLOSED");assert.equal(canonical(await facts()),checkpoint);
  const businessDate=getCurrentBusinessDateValue(new Date(),f.business.timezone,f.business.businessDayCutoffTime);
  const result=await f.h.actions.closeDailySnapshotAction({status:"idle",message:""},closingForm({branchId:f.branch.id,businessDate,actualCash:"1080",operationId:randomUUID()}));assert.equal(result.status,"error");assert.match(result.message,/retired/);
  assert.equal(canonical(await facts()),checkpoint);
 }finally{await h.close();await f.h.close();if(previousPerformance===undefined)delete process.env.TETAMU_PERFORMANCE_PHASE1;else process.env.TETAMU_PERFORMANCE_PHASE1=previousPerformance;}
});

test("retired Confirm rejects all branch/date inputs without new facts",async()=>{
 const f=await setup();try{
  const date=getCurrentBusinessDateValue(new Date(),f.business.timezone,f.business.businessDayCutoffTime);
  const confirm=(branchId:string,businessDate=date)=>f.h.actions.closeDailySnapshotAction({status:"idle",message:""},closingForm({branchId,businessDate,actualCash:"0",operationId:randomUUID()}));
  assert.equal((await confirm(f.branch.id)).status,"error");
  const foreign=await walletFixture(db);assert.match((await confirm(foreign.branch.id)).message,/retired/);
  assert.equal((await confirm(f.branch.id,"2099-01-01")).status,"error");assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
  await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})));
  const emptyBranch=await db.branch.create({data:{businessId:f.business.id,name:"Synthetic zero shift branch"}});
  const zero=await confirm(emptyBranch.id);assert.equal(zero.status,"error");assert.match(zero.message,/retired/);assert.deepEqual(await dailyCounts(f.business.id),[0,0,0,0]);
 }finally{await f.h.close()}
});

test("existing frozen snapshot no longer blocks Start; own OPEN still rejects duplicate",async()=>{
 const f=await setup();try {
  await actionRedirect(f.h.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0"})));
  const date=getCurrentBusinessDateValue(new Date(),f.business.timezone,f.business.businessDayCutoffTime);
  const snapshot=await db.dailyClosingSnapshot.create({data:{businessId:f.business.id,branchId:f.branch.id,businessDate:new Date(date+"T00:00:00Z"),timezone:f.business.timezone,businessType:"SALON_BEAUTY",closedByUserId:f.actor.id,expectedCashCents:0,actualCashCents:0,cashDifferenceCents:0,reportDataJson:{historical:true},whatsappText:"Frozen"}});
  assert.match(await actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"50"}))),/success/);
  assert.match(decodeURIComponent(await actionRedirect(f.h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:"50"})))),/already have an open shift/);
  assert.deepEqual(await db.dailyClosingSnapshot.findUnique({where:{id:snapshot.id}}),snapshot);
  assert.deepEqual(await dailyCounts(f.business.id),[1,0,0,0]);
 }finally{await f.h.close()}
});

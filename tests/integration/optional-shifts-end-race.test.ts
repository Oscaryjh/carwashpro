import assert from "node:assert/strict";
import test from "node:test";
import type {PrismaClient} from "@prisma/client";
import {walletTestDatabase,walletFixture} from "../helpers/wallet-fixture";
import {postWalletTopUp} from "../../src/lib/wallet/top-up";
import {checkoutFixture,checkoutHarness} from "../helpers/wallet-checkout-fixture";
import {createClosingActionsFixture,closingForm,actionRedirect} from "../helpers/closing-actions-fixture";

// Pause after the real activity read, using separate PostgreSQL connections.
function pauseActivityRead(database:PrismaClient, readMethod:"findMany"|"findFirst"="findMany") {
  let resume!:()=>void,seen!:()=>void,held=false;
  const ready=new Promise<void>(resolve=>seen=resolve),released=new Promise<void>(resolve=>resume=resolve);
  const db=new Proxy(database,{get(target,key){
    if(key==="$transaction")return (callback:Function,options:unknown)=>target.$transaction(tx=>callback(new Proxy(tx,{get(client,model){
      if(model!=="cashierShift")return Reflect.get(client,model);
      return new Proxy(client.cashierShift,{get(delegate,method){
        if(method!==readMethod)return Reflect.get(delegate,method);
        return async(args:any)=>{const result=await (delegate[readMethod] as Function)(args);if(!held){held=true;seen();await released;}return result;};
      }});
    }})),options as never);
    return Reflect.get(target,key);
  }}) as PrismaClient;
  return {db,ready,resume};
}

test("ON Card collection cannot attach to a shift after concurrent End has committed",async()=>{
  const db=walletTestDatabase(),endDb=walletTestDatabase();
  const barrier=pauseActivityRead(db);
  const end=await createClosingActionsFixture(endDb),sale=await checkoutHarness(barrier.db);
  try {
    const f=await checkoutFixture(db,"CARD");f.form.set("walletAmount","0");
    await sale.login(db,f);await end.login(f.actor.id);
    const running=sale.action.completeCashierSaleAction(f.form);
    await barrier.ready;
    const ended=await actionRedirect(end.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"50",notes:"Synthetic concurrency fixture"})));
    assert.doesNotMatch(ended,/type=error/);
    barrier.resume();
    const result=await running;
    assert.notEqual(result.status,"success","a finished shift must not receive a new collection");
    assert.match(result.message,/shift|CASHIER_SHIFT_MODE_CHANGED/i);
    assert.equal(await db.payment.count({where:{businessId:f.business.id,invoiceId:{not:null}}}),0);
    assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);
  } finally {barrier.resume();await sale.close();await end.close();await db.$disconnect();await endDb.$disconnect();}
});

for(const kind of ["cash","topup"] as const)test(`${kind} commits during End's snapshot; End retries with complete drawer facts`,{timeout:60000},async()=>{
  const db=walletTestDatabase(),endDb=walletTestDatabase(),barrier=pauseActivityRead(endDb,"findFirst");
  const end=await createClosingActionsFixture(barrier.db),h=await checkoutHarness(db);
  let ending:Promise<string>|undefined;
  try{
    const f=await checkoutFixture(db,"CASH");await h.login(db,f);await end.login(f.actor.id);f.form.set("walletAmount","0");
    const expected=kind==="cash"?90:100;
    ending=actionRedirect(end.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:String(expected),notes:"Concurrent collection fixture"})));
    await barrier.ready;
    if(kind==="cash")assert.equal((await h.action.completeCashierSaleAction(f.form)).status,"success");
    else await postWalletTopUp(f.ctx,{...f.input,operationKey:crypto.randomUUID()},db);
    barrier.resume();assert.doesNotMatch(await ending,/type=error/);
    const shift=await db.cashierShift.findUniqueOrThrow({where:{id:f.shift.id}});
    assert.equal(shift.status,"CLOSED");assert.equal(Number(shift.expectedCash),expected);assert.equal(Number(shift.cashDifference),0);
    assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);
  }finally{barrier.resume();await Promise.allSettled([ending]);await h.close();await end.close();await db.$disconnect();await endDb.$disconnect();}
});

test("normal ON refund paused at activity read rolls back after End commits",{timeout:60000},async()=>{
  const db=walletTestDatabase(),endDb=walletTestDatabase();
  const base=await checkoutHarness(db),end=await createClosingActionsFixture(endDb);
  const barrier=pauseActivityRead(db);let refundHarness:Awaited<ReturnType<typeof checkoutHarness>>|undefined,running:Promise<any>|undefined;
  try{
    const f=await checkoutFixture(db,"CASH");await base.login(db,f);f.form.set("walletAmount","0");
    const sold=await base.action.completeCashierSaleAction(f.form);assert.equal(sold.status,"success");
    const payment=await db.payment.findFirstOrThrow({where:{invoiceId:sold.invoice!.id}});
    refundHarness=await checkoutHarness(barrier.db);await refundHarness.login(db,f);await end.login(f.actor.id);
    const form=closingForm({operationId:crypto.randomUUID(),invoiceId:sold.invoice!.id,paymentId:payment.id,amount:"10",method:"CASH",reason:"Race refund",reference:"",modeAtConfirmation:"ON",shiftId:f.shift.id});
    running=refundHarness.invoices.refundPaymentAction({status:"idle",message:""},form);
    await Promise.race([barrier.ready,running.then(result=>{throw new Error(`Refund finished before activity barrier: ${JSON.stringify(result)}`);})]);
    assert.doesNotMatch(await actionRedirect(end.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"90",notes:"Race End"}))),/type=error/);
    barrier.resume();const result=await running;assert.equal(result.status,"error");assert.match(result.message,/CASHIER_SHIFT_MODE_CHANGED|shift/i);
    assert.equal(await db.paymentRefund.count({where:{paymentId:payment.id}}),0);
    assert.equal(await db.financialOperation.count({where:{businessId:f.business.id,operationKey:String(form.get("operationId"))}}),0);
  }finally{barrier.resume();await Promise.allSettled([running]);await refundHarness?.close();await base.close();await end.close();await db.$disconnect();await endDb.$disconnect();}
});

test("ON Top-up Card versus committed End has no wallet or collection writes",async()=>{
  const db=walletTestDatabase(),endDb=walletTestDatabase();
  const barrier=pauseActivityRead(db),end=await createClosingActionsFixture(endDb);
  try{
    const f=await walletFixture(db);
    await db.user.update({where:{id:f.actor.id},data:{email:`${f.actor.id}@example.test`}});await end.login(f.actor.id);
    const running=postWalletTopUp(f.ctx,{...f.input,paymentMethodCode:"BUILTIN_CARD"},barrier.db).then(value=>({value,error:null}),error=>({value:null,error}));
    await barrier.ready;
    assert.doesNotMatch(await actionRedirect(end.actions.endShiftAction(closingForm({shiftId:f.shift.id,closingCash:"0",notes:"Synthetic concurrency fixture"}))),/type=error/);
    barrier.resume();
    const result=await running;
    assert.equal(result.value,null); assert.match(String(result.error),/shift|CASHIER_SHIFT_MODE_CHANGED/i);
    assert.equal(await db.walletTopUp.count({where:{businessId:f.business.id}}),0);
    assert.equal(await db.walletTransaction.count({where:{businessId:f.business.id}}),0);
    assert.equal(await db.payment.count({where:{businessId:f.business.id}}),0);
  }finally{barrier.resume();await end.close();await db.$disconnect();await endDb.$disconnect();}
});

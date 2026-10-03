import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { holdBusinessLock } from "../helpers/optional-shifts-fixture";
import { saveCashierShiftSetting } from "../../src/lib/cashier/shift-settings";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { submitWalletTopUp } from "../../src/lib/wallet/ui-adapter";

// Real KEY SHARE / UPDATE acquisition on independent clients, not timing sleeps.
for (const command of ["cash", "topup"] as const) for (const winner of ["collection", "toggle"] as const) {
  test(`${command}: OFF collection versus ON toggle, ${winner} lock first`, {timeout:60000}, async()=>{
    const db=walletTestDatabase(),other=walletTestDatabase();
    const barrier=holdBusinessLock(winner==="collection"?db:other,winner==="collection"?"SHARE":"UPDATE");
    const h=await checkoutHarness(winner==="collection"?barrier.db:db);
    let running:Promise<any>|undefined,toggle:Promise<any>|undefined;
    try {
      const f=await checkoutFixture(db,"CASH"); await h.login(db,f);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED",endedAt:new Date()}});
      await saveCashierShiftSetting(other,{businessId:f.business.id,actor:{userId:f.actor.id},enabled:false});
      const beforePayments=await db.payment.count({where:{businessId:f.business.id}});
      f.form.set("walletAmount","0"); f.form.set("modeAtConfirmation","OFF"); f.form.set("shiftId","");
      const collect=()=>command==="cash" ? h.action.completeCashierSaleAction(f.form) : postWalletTopUp({...f.ctx,shiftId:null},{...f.input,operationKey:randomUUID(),modeAtConfirmation:"OFF",shiftId:null},winner==="collection"?barrier.db:db).then(value=>({status:"success",value}),error=>({status:"error",message:String(error)}));
      const change=()=>saveCashierShiftSetting(winner==="toggle"?barrier.db:other,{businessId:f.business.id,actor:{userId:f.actor.id},enabled:true});
      if(winner==="collection")running=collect(); else toggle=change();
      await barrier.ready;
      if(winner==="collection")toggle=change(); else running=collect();
      barrier.release();
      const [result]=await Promise.all([running!,toggle!]);
      assert.equal(result.status,winner==="collection"?"success":"error",JSON.stringify(result));
      if(winner==="toggle")assert.match(result.message,/CASHIER_SHIFT_MODE_CHANGED/);
      assert.equal((await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled,true);
      assert.equal(await db.payment.count({where:{businessId:f.business.id}}),beforePayments+(winner==="collection"?1:0));
      const newPayments=await db.payment.findMany({where:{businessId:f.business.id,shiftId:null}});
      assert.equal(newPayments.length,winner==="collection"?1:0);
      assert.equal(await db.cashierShift.count({where:{businessId:f.business.id,status:"OPEN"}}),0);
      assert.equal(await db.financialOperation.count({where:{businessId:f.business.id,state:{not:"COMPLETED"}}}),0);
    } finally {barrier.release();await Promise.allSettled([running,toggle]);await h.close();await db.$disconnect();await other.$disconnect();}
  });
}

for(const winner of [false,true])test(`simultaneous opposite toggles serialize with ${winner} first`,{timeout:60000},async()=>{
  const db=walletTestDatabase(),other=walletTestDatabase();const barrier=holdBusinessLock(db,"UPDATE");
  let first:Promise<unknown>|undefined,second:Promise<unknown>|undefined;
  try{
    const f=await walletFixture(db);await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
    const input={businessId:f.business.id,actor:{userId:f.actor.id}};
    first=saveCashierShiftSetting(barrier.db,{...input,enabled:winner});await barrier.ready;
    second=saveCashierShiftSetting(other,{...input,enabled:!winner});barrier.release();
    await Promise.all([first,second]);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled,!winner);
    assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:"CASHIER_SHIFTS_SETTING_CHANGED"}}),winner?1:2);
    assert.equal(await db.payment.count({where:{businessId:f.business.id}}),0);
  }finally{barrier.release();await Promise.allSettled([first,second]);await db.$disconnect();await other.$disconnect();}
});

test("completed cash and TopUp replay preserve original fingerprints through OFF ON and replacement Shift",async()=>{
  const db=walletTestDatabase(),h=await checkoutHarness(db);
  try{
    const f=await checkoutFixture(db,"CASH");await h.login(db,f);f.form.set("walletAmount","0");
    const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success");
    const top=await submitWalletTopUp(f.ctx,f.input,db);
    const snapshot=()=>db.financialOperation.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}});
    const original=await snapshot(); const paymentCount=await db.payment.count({where:{businessId:f.business.id}});
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
    for(const enabled of [false,true]){
      await saveCashierShiftSetting(db,{businessId:f.business.id,actor:{userId:f.actor.id},enabled});
      if(enabled)await db.cashierShift.create({data:{businessId:f.business.id,branchId:f.branch.id,cashierId:f.actor.id}});
      assert.deepEqual(await h.action.completeCashierSaleAction(f.form),sale);
      const replay=await submitWalletTopUp({...f.ctx,shiftId:null},f.input,db);
      assert.equal(replay.topUpId,top.topUpId);assert.equal(replay.shiftId,f.shift.id);assert.equal(replay.replayed,true);
      assert.deepEqual(await snapshot(),original);assert.equal(await db.payment.count({where:{businessId:f.business.id}}),paymentCount);
    }
    const stale=new FormData();for(const [key,value] of f.form.entries())stale.append(key,value);stale.set("operationId",randomUUID());
    const rejected=await h.action.completeCashierSaleAction(stale);assert.match(rejected.message,/CASHIER_SHIFT_MODE_CHANGED/);
    assert.deepEqual(await snapshot(),original);assert.equal(await db.payment.count({where:{businessId:f.business.id}}),paymentCount);
  }finally{await h.close();await db.$disconnect();}
});

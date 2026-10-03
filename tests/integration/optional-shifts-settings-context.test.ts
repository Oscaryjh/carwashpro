import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { createClosingActionsFixture, closingForm, actionRedirect } from "../helpers/closing-actions-fixture";
import { saveCashierShiftSetting, parseCashierShiftSetting } from "../../src/lib/cashier/shift-settings";
import { resolveCashierActivityContext } from "../../src/lib/cashier/activity-context";
import type { PrismaClient } from "@prisma/client";
import { createOptionalSettingsFixture, holdBusinessLock } from "../helpers/optional-shifts-fixture";

test("settings: strict parse, authorization, all-branch OPEN/stale guard, transitions and atomic audit", async () => {
  const db=walletTestDatabase();
  try {
    for(const invalid of [null,undefined,'', 'falsey','0',true]) assert.throws(()=>parseCashierShiftSetting(invalid));
    assert.equal(parseCashierShiftSetting('false'),false);
    assert.equal(parseCashierShiftSetting('true'),true);
    const f=await walletFixture(db), foreign=await walletFixture(db);
    const actor={userId:f.actor.id};
    const save=(enabled:unknown)=>saveCashierShiftSetting(db,{businessId:f.business.id,actor,enabled,request:{ipAddress:'127.0.0.1',userAgent:'disposable'}});
    await assert.rejects(save('false'),/invalid/i);
    await assert.rejects(save(undefined),/invalid/i);
    await assert.rejects(saveCashierShiftSetting(db,{businessId:f.business.id,actor:{userId:foreign.actor.id},enabled:false}),/denied/i);
    const staff=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,name:'Cashier',role:'STAFF',permissions:['CLOSING']}});
    await assert.rejects(saveCashierShiftSetting(db,{businessId:f.business.id,actor:{userId:staff.id},enabled:false}),/denied/i);
    await save(true);
    assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:'CASHIER_SHIFTS_SETTING_CHANGED'}}),0);
    await assert.rejects(save(false),/End all open cashier shifts/);
    await db.cashierShift.update({where:{id:f.shift.id},data:{startedAt:new Date('2020-01-01')}});
    await assert.rejects(save(false),/End all open cashier shifts/);
    const otherBranch=await db.branch.create({data:{businessId:f.business.id,name:'Other'}});
    await db.cashierShift.update({where:{id:f.shift.id},data:{branchId:otherBranch.id,cashierId:staff.id}});
    await assert.rejects(save(false),/End all open cashier shifts/);
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:'CLOSED',endedAt:new Date()}});
    await save(false); await save(false);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled,false);
    const logs=await db.auditLog.findMany({where:{businessId:f.business.id,action:'CASHIER_SHIFTS_SETTING_CHANGED'}});
    assert.equal(logs.length,1);assert.deepEqual(logs[0].before,{cashierShiftsEnabled:true});assert.deepEqual(logs[0].after,{cashierShiftsEnabled:false});assert.equal(logs[0].actorUserId,f.actor.id);assert.equal(logs[0].ipAddress,'127.0.0.1');assert.equal(logs[0].userAgent,'disposable');
    const shiftBefore=await db.cashierShift.findMany({where:{businessId:f.business.id}});
    await save(true);assert.deepEqual(await db.cashierShift.findMany({where:{businessId:f.business.id}}),shiftBefore);
    // Inject failure only at the audit write, keeping the actual transaction and database.
    const failing=new Proxy(db,{get(target,key){if(key==='$transaction') return (cb:Function,options:unknown)=>target.$transaction(tx=>cb(new Proxy(tx,{get(t,k){if(k==='auditLog')return {create:async()=>{throw Error('audit unavailable')}};return Reflect.get(t,k);}})),options as never);return Reflect.get(target,key);}}) as PrismaClient;
    await assert.rejects(saveCashierShiftSetting(failing,{businessId:f.business.id,actor,enabled:false}),/audit unavailable/);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled,true);
    assert.equal(await db.auditLog.count({where:{businessId:f.business.id,action:'CASHIER_SHIFTS_SETTING_CHANGED'}}),2);
  }finally{await db.$disconnect();}
});

test("setting server action uses authenticated tenant, refuses omitted/malformed and unauthorized requests",async()=>{
  const db=walletTestDatabase(),h=await createOptionalSettingsFixture(db);try{
    const f=await walletFixture(db);await db.user.update({where:{id:f.actor.id},data:{email:`${randomUUID()}@test.invalid`}});await h.login(f.actor.id);
    const idle={status:'idle' as const,message:''};
    for(const value of [undefined,'bogus']){const form=new FormData();if(value)form.set('cashierShiftsEnabled',value);const result=await h.actions.saveCashierOperationsAction(idle,form);assert.equal(result.status,'error');}
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:'CLOSED'}});
    const result=await h.actions.saveCashierOperationsAction(idle,closingForm({cashierShiftsEnabled:'false'}));assert.equal(result.status,'success');
    assert.equal((await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled,false);
    const staff=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,email:`${randomUUID()}@test.invalid`,name:'Staff',role:'STAFF',permissions:['CLOSING']}});await h.login(staff.id);
    const denied=await actionRedirect(h.actions.saveCashierOperationsAction(idle,closingForm({cashierShiftsEnabled:'true'})));assert.match(denied,/denied/);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled,false);
  }finally{await h.close();await db.$disconnect();}
});

for(const first of ['SHARE','UPDATE'] as const) test(`Start vs toggle deterministic ${first} lock wins`,async()=>{
  const db=walletTestDatabase(),second=walletTestDatabase();const barrier=holdBusinessLock(first==='SHARE'?db:second,first);
  const h=await createClosingActionsFixture(first==='SHARE'?barrier.db:db);
  let start:Promise<string>|undefined,toggle:Promise<unknown>|undefined;
  try{
    const f=await walletFixture(db);await db.user.update({where:{id:f.actor.id},data:{email:`${randomUUID()}@test.invalid`}});await db.cashierShift.update({where:{id:f.shift.id},data:{status:'CLOSED'}});await h.login(f.actor.id);
    const runStart=()=>actionRedirect(h.actions.startShiftAction(closingForm({branchId:f.branch.id,openingFloat:'0.00'})));
    const runToggle=()=>saveCashierShiftSetting(first==='UPDATE'?barrier.db:second,{businessId:f.business.id,actor:{userId:f.actor.id},enabled:false});
    if(first==='SHARE')start=runStart();else toggle=runToggle();
    await barrier.ready;
    if(first==='SHARE')toggle=runToggle();else start=runStart();
    // Both operations are in flight; the real locked transaction remains open.
    barrier.release();
    const [s,t]=await Promise.allSettled([start!,toggle!]);assert.equal(s.status,'fulfilled');
    const mode=(await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled;
    assert.equal(mode,first==='SHARE');
    assert.equal(await db.cashierShift.count({where:{businessId:f.business.id,status:'OPEN'}}),first==='SHARE'?1:0);
    assert.equal(t.status,first==='SHARE'?'rejected':'fulfilled');
    assert.match(decodeURIComponent((s as PromiseFulfilledResult<string>).value),first==='SHARE'?/Shift started/:/disabled/);
  }finally{barrier.release();await Promise.allSettled([start,toggle]);await h.close();await db.$disconnect();await second.$disconnect();}
});

test("activity: fresh mode, scoped active branch, own current OPEN and canonical cutoff",async()=>{
  const db=walletTestDatabase();try{
    const f=await walletFixture(db),foreign=await walletFixture(db);
    const at=new Date('2026-10-02T17:59:00Z');
    await db.cashierShift.update({where:{id:f.shift.id},data:{startedAt:at}});
    const input={businessId:f.business.id,branchId:f.branch.id,actor:{userId:f.actor.id},activityAt:at};
    const resolve=(extra:object={})=>db.$transaction(tx=>resolveCashierActivityContext(tx,{...input,...extra}));
    const on=await resolve();assert.equal(on.shiftId,f.shift.id);assert.equal(on.businessDate,'2026-10-02');
    await assert.rejects(resolve({branchId:foreign.branch.id}),/branch/i);
    await assert.rejects(resolve({actor:{userId:foreign.actor.id}}),/denied/i);
    await db.branch.update({where:{id:f.branch.id},data:{status:'INACTIVE'}});
    await assert.rejects(resolve(),/branch/i);await db.branch.update({where:{id:f.branch.id},data:{status:'ACTIVE'}});
    await assert.rejects(resolve({activityAt:new Date('2026-10-02T18:01:00Z')}),/cutoff/);
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:'CLOSED'}});
    await assert.rejects(resolve({cashierShiftsEnabled:false}),/open shift/i);
    await db.business.update({where:{id:f.business.id},data:{cashierShiftsEnabled:false}});
    const off=await resolve({cashierShiftsEnabled:true,shiftId:f.shift.id});assert.equal(off.shiftId,null);assert.equal(off.cashierShiftsEnabled,false);
    const staff=await db.user.create({data:{businessId:f.business.id,branchId:f.branch.id,name:'Scoped',role:'STAFF',permissions:['CLOSING','POS']}});
    const other=await db.branch.create({data:{businessId:f.business.id,name:'Unauthorized'}});
    await assert.rejects(resolve({actor:{userId:staff.id},branchId:other.id}),/branch/i);
  }finally{await db.$disconnect();}
});

test("authenticated Start refuses OFF; Start vs toggle uses two connections and only legal outcomes",async()=>{
  const db=walletTestDatabase(),second=walletTestDatabase();const h=await createClosingActionsFixture(db);
  try{
    const f=await walletFixture(db);await db.user.update({where:{id:f.actor.id},data:{email:`${randomUUID()}@test.invalid`}});await h.login(f.actor.id);
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:'CLOSED',endedAt:new Date()}});
    const form=()=>closingForm({branchId:f.branch.id,openingFloat:'0.00'});
    await saveCashierShiftSetting(second,{businessId:f.business.id,actor:{userId:f.actor.id},enabled:false});
    const denied=await actionRedirect(h.actions.startShiftAction(form()));assert.match(decodeURIComponent(denied),/Cashier shifts are disabled/);
    assert.equal(await db.cashierShift.count({where:{businessId:f.business.id,status:'OPEN'}}),0);
    for(let round=0;round<8;round++){
      await saveCashierShiftSetting(second,{businessId:f.business.id,actor:{userId:f.actor.id},enabled:true});
      const [start,toggle]=await Promise.allSettled([actionRedirect(h.actions.startShiftAction(form())),saveCashierShiftSetting(second,{businessId:f.business.id,actor:{userId:f.actor.id},enabled:false})]);
      assert.equal(start.status,'fulfilled',start.status==='rejected' ? String(start.reason) : '');
      const mode=(await db.business.findUniqueOrThrow({where:{id:f.business.id}})).cashierShiftsEnabled;
      const open=await db.cashierShift.count({where:{businessId:f.business.id,status:'OPEN'}});
      if(mode){assert.equal(open,1);assert.equal(toggle.status,'rejected');assert.match(decodeURIComponent((start as PromiseFulfilledResult<string>).value),/Shift started/);}
      else{assert.equal(open,0);assert.equal(toggle.status,'fulfilled');assert.match(decodeURIComponent((start as PromiseFulfilledResult<string>).value),/disabled/);}
      await db.cashierShift.updateMany({where:{businessId:f.business.id,status:'OPEN'},data:{status:'CLOSED',endedAt:new Date()}});
    }
  }finally{await h.close();await db.$disconnect();await second.$disconnect();}
});

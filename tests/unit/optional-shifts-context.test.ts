import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { resolveCashierActivityContext } from "../../src/lib/cashier/activity-context";
import { parseCashierShiftSetting } from "../../src/lib/cashier/shift-settings";

test("setting parser never coerces missing/malformed form value to OFF",()=>{
  for(const value of [null,undefined,'',0,false,'0','on','off']) assert.throws(()=>parseCashierShiftSetting(value));
  assert.equal(parseCashierShiftSetting('true'),true);assert.equal(parseCashierShiftSetting('false'),false);
});

test("activity context fresh DB mode, cutoff and multiple OPEN rejection",async()=>{
  let enabled=false;let shifts:object[]=[];let locks=0;
  const tx={user:{findUnique:async()=>({id:'user',businessId:'business',branchId:'branch',role:'BUSINESS_OWNER',permissions:[],status:'active',loginEnabled:true,business:{id:'business',status:'active',industryType:'SALON_BEAUTY'},branch:{id:'branch',businessId:'business',status:'ACTIVE'}})},branch:{findFirst:async()=>({id:'branch'})},business:{findUniqueOrThrow:async()=>({cashierShiftsEnabled:enabled,timezone:'Asia/Kuching',businessDayCutoffTime:'02:00'})},cashierShift:{findMany:async()=>shifts},$queryRaw:async()=>{locks++;return [{id:'business'}]}} as unknown as Prisma.TransactionClient;
  const input={businessId:'business',branchId:'branch',actor:{userId:'user'},activityAt:new Date('2026-10-02T18:01:00Z')};
  assert.equal((await resolveCashierActivityContext(tx,input)).shiftId,null);
  assert.equal((await resolveCashierActivityContext(tx,input)).businessDate,'2026-10-03');
  await assert.rejects(resolveCashierActivityContext(tx,{...input,confirmation:{modeAtConfirmation:'ON',shiftId:null}}),{code:'CASHIER_SHIFT_MODE_CHANGED'});
  await assert.rejects(resolveCashierActivityContext(tx,{...input,confirmation:{modeAtConfirmation:'OFF',shiftId:'previous-shift'}}),{code:'CASHIER_SHIFT_MODE_CHANGED'});
  enabled=true;await assert.rejects(resolveCashierActivityContext(tx,input),/open shift/);
  shifts=[{id:'shift',branchId:'branch',startedAt:input.activityAt}];assert.equal((await resolveCashierActivityContext(tx,input)).shiftId,'shift');
  shifts.push({id:'other',branchId:'branch',startedAt:input.activityAt});await assert.rejects(resolveCashierActivityContext(tx,input),/open shift/);
  assert.equal(locks,7);
});

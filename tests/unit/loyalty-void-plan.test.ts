import assert from "node:assert/strict";
import test from "node:test";
import { planVoidLoyalty } from "../../src/lib/loyalty/void-plan";
const facts=[{id:"redeem",paymentId:"cash",type:"REDEEM",points:-500},{id:"earn",paymentId:"cash",type:"EARN",points:90}];
test("VOID restores original redeem and reverses original earn in one net balance",()=>{
  const result=planVoidLoyalty(590,facts);
  assert.equal(result.balance,1000);assert.equal(result.restored,500);assert.equal(result.reversed,90);
  assert.deepEqual(result.rows.map(r=>[r.type,r.points]),[["REDEMPTION_REFUND",500],["REFUND_REVERSAL",-90]]);
});
test("VOID net balance is independent of leg order and never clamps before restore",()=>{
  assert.equal(planVoidLoyalty(0,facts).balance,410);
  assert.equal(planVoidLoyalty(0,[...facts].reverse()).balance,410);
  assert.equal(planVoidLoyalty(0,[facts[1]]).balance,0);
});
test("no original activity does not create empty compensation",()=>{
  assert.deepEqual(planVoidLoyalty(20,[]),{balance:20,restored:0,reversed:0,rows:[]});
});
test("multi-payment earning sums originals without repeating redemption",()=>{
  const result=planVoidLoyalty(590,[facts[0],{...facts[1],points:45},{...facts[1],id:"earn-wallet",paymentId:"wallet",points:45}]);
  assert.equal(result.restored,500);assert.equal(result.reversed,90);assert.equal(result.balance,1000);
});
test("ambiguous, previously compensated or malformed ledger evidence fails closed",()=>{
  assert.throws(()=>planVoidLoyalty(590,[...facts,facts[1]]));
  assert.throws(()=>planVoidLoyalty(590,[{...facts[0],points:500}]));
  assert.throws(()=>planVoidLoyalty(590,[{...facts[1],type:"REFUND_REVERSAL",points:-90}]));
  assert.throws(()=>planVoidLoyalty(-1,facts));
});

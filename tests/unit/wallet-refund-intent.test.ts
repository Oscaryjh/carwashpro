import assert from "node:assert/strict";
import test from "node:test";
test("refund recovery freezes full request, original key and scope; storage failure never sends",async()=>{
 const m=await import("../../src/lib/wallet/refund-intent").catch(()=>null);assert.ok(m?.WalletRefundIntent);
 let saved:string|null=null;const storage={read:()=>saved,write:(s:string)=>{saved=s;},remove:()=>{saved=null;}};
 const intent=new m.WalletRefundIntent("business:owner:invoice",storage);
 const fields={reason:"Correction",legs:'[{"method":"CARD","reference":"original","amountCents":2000}]',stockLines:"[]"};
 const first=intent.begin(fields)!;assert.ok(first.operationKey);assert.equal(intent.begin(fields),null);intent.uncertain();
 const recovered=new m.WalletRefundIntent("business:owner:invoice",storage);
 assert.deepEqual(recovered.begin({...fields,reason:"changed"}),first);recovered.uncertain();
 assert.throws(()=>new m.WalletRefundIntent("foreign:owner:invoice",storage));
 recovered.completed();assert.equal(saved,null);
 const broken=new m.WalletRefundIntent("scope",{...storage,write(){throw new Error("quota");}});assert.throws(()=>broken.begin(fields));assert.equal(broken.existing,null);
});
test("definitive first rejection allows correction; unknown or restored request never clears",async()=>{
 const {WalletRefundIntent}=await import("../../src/lib/wallet/refund-intent");let saved:string|null=null;const storage={read:()=>saved,write:(s:string)=>{saved=s;},remove:()=>{saved=null;}};
 const i=new WalletRefundIntent("scope",storage);i.begin({reason:"invalid"});
 assert.equal((i as unknown as {rejected:()=>boolean}).rejected(),true);assert.equal(i.existing,null);
 i.begin({reason:"original"});i.uncertain();assert.equal((i as unknown as {rejected:()=>boolean}).rejected(),false);assert.ok(i.existing);
 const restored=new WalletRefundIntent("scope",storage);assert.equal((restored as unknown as {rejected:()=>boolean}).rejected(),false);
});
test("Card reference and stock treatment are validated before freezing",async()=>{
 const m=await import("../../src/lib/wallet/refund-intent") as unknown as {validateRefundIntentFields:(f:Record<string,string>)=>void};assert.equal(typeof m.validateRefundIntentFields,"function");
 const input={kind:"refund",reason:"Correction",legs:'[{"method":"CARD","amountCents":2000,"reference":""}]',stockLines:"[]"};
 assert.throws(()=>m.validateRefundIntentFields(input),/reference/i);
 assert.doesNotThrow(()=>m.validateRefundIntentFields({...input,legs:'[{"method":"CARD","amountCents":2000,"reference":"card-ref"}]'}));
 assert.throws(()=>m.validateRefundIntentFields({...input,legs:'[{"method":"CASH","amountCents":2000}]',stockLines:'[{"quantity":1,"disposition":"NO_RESTOCK","noRestockReason":""}]'}),/reason/i);
});
test("saved invoice refund/void and top-up reversal can be recovered by source when actions are temporarily unavailable",async()=>{
 const {findSavedRefundIntent}=await import("../../src/lib/wallet/refund-intent");
 const request={operationKey:"original-operation",fields:{kind:"refund",sourceId:"invoice-1",businessId:"business-1",reason:"Original refund",legs:'[]',stockLines:"[]"}};
 const entries=[["wallet-refund:business-1:owner-1:invoice:invoice-1",JSON.stringify({scope:"business-1:owner-1:invoice:invoice-1",request})] as const];
 assert.deepEqual(findSavedRefundIntent(entries,"invoice-1","invoice","business-1:owner-1:invoice:invoice-1"),request);
 assert.equal(findSavedRefundIntent(entries,"invoice-2","invoice","business-1:owner-1:invoice:invoice-1"),null);
 assert.equal(findSavedRefundIntent(entries,"invoice-1","top-up","business-1:owner-1:invoice:invoice-1"),null);
 assert.equal(findSavedRefundIntent(entries,"invoice-1","invoice","business-2:other-owner:invoice:invoice-1"),null,"another business/actor cannot see this confirmation");
 const voidRequest={...request,fields:{...request.fields,kind:"void"}};
 assert.deepEqual(findSavedRefundIntent([["wallet-refund:void",JSON.stringify({scope:"business-1:owner-1:invoice:invoice-1",request:voidRequest})]],"invoice-1","invoice","business-1:owner-1:invoice:invoice-1"),voidRequest);
 const topUpRequest={...request,fields:{...request.fields,kind:"reversal",sourceId:"top-up-1"}};
 assert.deepEqual(findSavedRefundIntent([["wallet-refund:reversal",JSON.stringify({scope:"business-1:owner-1:top-up:top-up-1",request:topUpRequest})]],"top-up-1","top-up","business-1:owner-1:top-up:top-up-1"),topUpRequest);
});

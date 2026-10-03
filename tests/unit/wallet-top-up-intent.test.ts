import assert from "node:assert/strict";
import test from "node:test";
async function controller() {
  const module = await import("../../src/lib/wallet/top-up-intent").catch(() => null);
  assert.ok(module?.WalletTopUpIntent, "Shared top-up intent controller must exist");
  return new module.WalletTopUpIntent();
}
const payload = { customerId: "customer", offerId: "offer", expectedOfferVersion: 0, paymentMethodCode: "BUILTIN_CASH", reference: "" };

test("authoritative mode rejection requires explicit reconfirmation and retains financial request/key",async()=>{
  const intent=await controller();
  const first=intent.confirm({...payload,modeAtConfirmation:"ON",branchId:"branch",shiftId:"old"})!;
  intent.uncertain();
  assert.throws(()=>intent.reconfirmActivity({modeAtConfirmation:"OFF",branchId:"branch",shiftId:null}));
  intent.modeChanged();
  assert.deepEqual(intent.existing,first);
  intent.reconfirmActivity({modeAtConfirmation:"OFF",branchId:"branch",shiftId:null});
  const retry=intent.confirm(payload)!;
  assert.deepEqual(retry,{...first,modeAtConfirmation:"OFF",shiftId:null});
  assert.equal(retry.operationKey,first.operationKey);
});
test("double click blocked and uncertain response retry reuses exact payload/key", async () => {
  const intent = await controller();
  const first = intent.confirm(payload);
  assert.ok(first);
  assert.equal(intent.confirm(payload), null);
  intent.uncertain();
  assert.equal(intent.locked, true);
  const retry = intent.confirm({ ...payload, offerId: "different" });
  assert.deepEqual(retry, first);
  intent.completed();
  assert.equal(intent.locked, false);
});
test("stale rejection does not auto-submit; next explicit confirm creates new key", async () => {
  const intent = await controller();
  const first = intent.confirm(payload)!;
  intent.rejected();
  assert.equal(intent.locked, false);
  const next = intent.confirm({ ...payload, expectedOfferVersion: 1 })!;
  assert.notEqual(next.operationKey, first.operationKey);
  assert.equal(next.expectedOfferVersion, 1);
});
test("a later auth rejection cannot discard a prior unknown collection outcome", async () => {
  const intent = await controller();
  const first = intent.confirm(payload)!;
  intent.uncertain();
  intent.confirm(payload);
  assert.equal(intent.rejected(), false);
  assert.equal(intent.locked, true);
  assert.deepEqual(intent.confirm(payload), first);
});
test("pending request survives component destruction and restores its original key", async () => {
  const { WalletTopUpIntent } = await import("../../src/lib/wallet/top-up-intent");
  let stored: string | null = null;
  const storage = { read: () => stored, write: (value: string) => { stored = value; }, remove: () => { stored = null; } };
  const first = new WalletTopUpIntent(storage).confirm(payload)!;
  const restored = new WalletTopUpIntent(storage);
  assert.equal(restored.locked, true);
  assert.deepEqual(restored.confirm({ ...payload, offerId: "wrong" }), first);
  restored.uncertain();
  assert.equal(restored.rejected(), false);
  restored.completed();
  assert.equal(stored, null);
});

test("legacy request without activity accepts an explicitly reviewed branch only after authoritative mode rejection",async()=>{
 const {WalletTopUpIntent}=await import("../../src/lib/wallet/top-up-intent");
 const original={...payload,operationKey:"original-legacy-key"};
 let stored=JSON.stringify(original);
 const intent=new WalletTopUpIntent({read:()=>stored,write:value=>{stored=value;},remove:()=>{stored="";}});
 const activity={modeAtConfirmation:"OFF" as const,branchId:"explicit-branch",shiftId:null};
 assert.throws(()=>intent.reconfirmActivity(activity));
 intent.modeChanged();intent.reconfirmActivity(activity);
 assert.deepEqual(intent.existing,{...original,...activity});
 assert.equal(intent.existing?.operationKey,original.operationKey);
});
test("unknown followed by authoritative stale version permits explicit reconfirmation", async () => {
  const intent = await controller();
  const first = intent.confirm(payload)!;
  intent.uncertain();
  intent.confirm(payload);
  assert.equal(intent.rejected(true), true);
  assert.equal(intent.locked, false);
  const next = intent.confirm({ ...payload, expectedOfferVersion: 1 })!;
  assert.notEqual(next.operationKey, first.operationKey);
});

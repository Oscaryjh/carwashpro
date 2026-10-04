import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST,"true","Disposable runner required");
const db=walletTestDatabase();after(()=>db.$disconnect());
test("Points read is scoped, fresh and does not create missing membership/program",async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db);await h.login(db,f);
  assert.equal(typeof h.action.cashierPointsOptionsAction,"function","readonly action must exist");
  const before=JSON.stringify(await Promise.all([db.customer.findMany(),db.customerMembership.findMany(),db.loyaltyProgram.findMany(),db.loyaltyTransaction.findMany()]));
  const empty=await h.action.cashierPointsOptionsAction(f.customer.id);
  assert.equal(empty.ok,true);if(!empty.ok)throw Error("missing result");
  assert.equal(empty.data.membershipStatus,null);assert.equal(empty.data.availablePoints,0);assert.equal(empty.data.settings.enabled,false);
  assert.equal(JSON.stringify(await Promise.all([db.customer.findMany(),db.customerMembership.findMany(),db.loyaltyProgram.findMany(),db.loyaltyTransaction.findMany()])),before);
  const foreign=await db.customer.create({data:{businessId:(await checkoutFixture(db)).business.id,name:"Foreign",phone:"000"}});
  assert.equal((await h.action.cashierPointsOptionsAction(foreign.id)).ok,false);
  const member=await db.customerMembership.create({data:{businessId:f.business.id,customerId:f.customer.id,pointsBalance:2000}});
  await db.loyaltyProgram.create({data:{businessId:f.business.id,enabled:true,redemptionEnabled:true,redemptionPointsPerRinggit:250,minimumRedemptionPoints:500}});
  await db.customerMembership.update({where:{id:member.id},data:{pointsBalance:1500}});
  const current=await h.action.cashierPointsOptionsAction(f.customer.id);assert.equal(current.ok,true);
  if(current.ok){assert.equal(current.data.availablePoints,1500);assert.equal(current.data.membershipStatus,"ACTIVE");assert.equal(current.data.settings.pointsPerRinggit,250);assert.equal(current.data.settings.minimumPoints,500);}
  for(const [status,enabled,redemptionEnabled] of [["INACTIVE",true,true],["ACTIVE",false,true],["ACTIVE",true,false]] as const){
   await db.customerMembership.update({where:{id:member.id},data:{status}});
   await db.loyaltyProgram.update({where:{businessId:f.business.id},data:{enabled,redemptionEnabled}});
   const snapshot=async()=>JSON.stringify(await Promise.all([db.customer.findMany(),db.customerMembership.findMany(),db.loyaltyProgram.findMany(),db.loyaltyTransaction.findMany(),db.invoice.findMany(),db.payment.findMany(),db.walletAccount.findMany(),db.walletTransaction.findMany()]));
   const beforeRead=await snapshot();const result=await h.action.cashierPointsOptionsAction(f.customer.id);
   assert.equal(result.ok,true);if(result.ok){assert.equal(result.data.membershipStatus,status);assert.equal(result.data.settings.enabled,enabled);assert.equal(result.data.settings.redemptionEnabled,redemptionEnabled);}
   assert.equal(await snapshot(),beforeRead,"readonly refresh must not mutate business/financial facts");
  }
  assert.equal((await h.action.cashierPointsOptionsAction("")).ok,false);
  assert.equal((await h.action.cashierPointsOptionsAction("nonexistent")).ok,false);
 }finally{await h.close();}
});

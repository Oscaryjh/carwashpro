import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { resolveCashierActivityContext } from "../../src/lib/cashier/activity-context";
import { saveCashierShiftSetting } from "../../src/lib/cashier/shift-settings";

test("new business defaults OFF without fake shift; explicit opt-in and OPEN guard remain", async () => {
  const db = walletTestDatabase();
  try {
    const business = await db.business.create({data:{name:"Default OFF",slug:randomUUID()}});
    assert.equal(business.cashierShiftsEnabled,false);
    const branch = await db.branch.create({data:{businessId:business.id,name:"Main"}});
    const actor = await db.user.create({data:{businessId:business.id,branchId:branch.id,name:"Owner",role:"BUSINESS_OWNER"}});
    const context = await db.$transaction(tx=>resolveCashierActivityContext(tx,{businessId:business.id,branchId:branch.id,actor:{userId:actor.id}}));
    assert.equal(context.shiftId,null);
    assert.equal(await db.cashierShift.count({where:{businessId:business.id}}),0);
    const save = (enabled:boolean)=>saveCashierShiftSetting(db,{businessId:business.id,actor:{userId:actor.id},enabled});
    await save(true);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:business.id}})).cashierShiftsEnabled,true);
    assert.equal(await db.cashierShift.count({where:{businessId:business.id}}),0);
    await db.cashierShift.create({data:{businessId:business.id,branchId:branch.id,cashierId:actor.id}});
    await assert.rejects(save(false),/End all open cashier shifts/);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:business.id}})).cashierShiftsEnabled,true);
  } finally { await db.$disconnect(); }
});

test("raw business insert also defaults OFF independently of Prisma Client", async () => {
  const db=walletTestDatabase();
  try {
    const id=randomUUID();
    await db.$executeRaw`INSERT INTO businesses(id,name,slug,industry_type,updated_at) VALUES(${id}::uuid,'SQL default',${randomUUID()},'SALON_BEAUTY',now())`;
    assert.equal((await db.business.findUniqueOrThrow({where:{id}})).cashierShiftsEnabled,false);
  } finally { await db.$disconnect(); }
});

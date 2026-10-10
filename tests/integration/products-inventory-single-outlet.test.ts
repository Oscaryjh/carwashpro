import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "../../src/lib/prisma";
import { compileOutletActionPages, findOutletFormAction } from "../helpers/outlet-action-pages";
import { importOutletUiContext } from "../helpers/outlet-ui-server-import";

test("single-outlet actual page actions preserve original stock writers and reject stale/foreign/revoked scope", async t => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55440");
  assert.match(url.pathname, /^\/tetamu_phase1a1_disposable_\d+$/);
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: "Phase1A1 Single", slug: `single-${suffix}` } });
  const foreign = await prisma.business.create({ data: { name: "Phase1A1 Foreign", slug: `foreign-${suffix}` } });
  await prisma.businessModuleEntitlement.createMany({ data: ["POS", "INVENTORY"].map(moduleKey => ({ businessId: business.id, moduleKey: moduleKey as "POS", status: "ENABLED" as const, source: "MANUAL" as const, enabledFrom: new Date(0) })) });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Internal current" } });
  const old = await prisma.branch.create({ data: { businessId: business.id, name: "Historic", status: "INACTIVE" } });
  const foreignBranch = await prisma.branch.create({ data: { businessId: foreign.id, name: "Foreign" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, role: "BUSINESS_OWNER", name: "Synthetic Owner" } });
  const category = await prisma.productCategory.create({ data: { businessId: business.id, name: "Synthetic" } });
  const identity = { businessId: business.id, userId: owner.id };
  const pages = await compileOutletActionPages(identity);
  const form = (values: Record<string, string>) => { const data = new FormData(); Object.entries(values).forEach(([k, v]) => data.set(k, v)); return data; };
  let productId = "";
  try {
    await t.test("Product starting 10 uses existing Opening Balance on active internal branch", async () => {
      const action = findOutletFormAction(await pages.Products({ searchParams: Promise.resolve({ modal: "create" }) }), "ProductCreateModal");
      await assert.rejects(action(form({ name: `Shampoo ${suffix}`, categoryId: category.id, price: "10", trackInventory: "on", [`stock_${branch.id}`]: "10", [`reorder_${branch.id}`]: "2" })), /REDIRECT:\/products\//);
      const product = await prisma.product.findFirstOrThrow({ where: { businessId: business.id } }); productId = product.id;
      assert.equal((await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: branch.id, productId } } })).quantity, 10);
      assert.equal(await prisma.inventoryMovement.count({ where: { productId, branchId: branch.id, type: "OPENING_BALANCE", quantityDelta: 10 } }), 1);
      await prisma.productStock.create({ data: { businessId: business.id, branchId: old.id, productId, quantity: 99 } });
    });
    const stockData = () => form({ branchId: branch.id, productId, quantity: "5", operationKey: `PHASE1A1:${randomUUID()}`, reason: "Synthetic stock added", reference: "Fixture reference" });
    await t.test("Add Stock reaches active branch, one movement, original redirect and replay contract", async () => {
      const action = findOutletFormAction(await pages.AddStock({ searchParams: Promise.resolve({ productId }) }), "InventoryCommandForm");
      const data = stockData();
      for (let i = 0; i < 2; i++) await assert.rejects(action(data), /type=success&message=Inventory%20movement%20recorded\./);
      assert.equal((await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: branch.id, productId } } })).quantity, 15);
      assert.equal((await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: old.id, productId } } })).quantity, 99);
      assert.equal(await prisma.inventoryMovement.count({ where: { operationKey: data.get("operationKey")!.toString() } }), 1);
    });
    const snapshot = async () => JSON.stringify(await Promise.all([prisma.productStock.findMany({ where: { businessId: business.id }, orderBy: { id: "asc" } }), prisma.inventoryMovement.count({ where: { businessId: business.id } })]));
    await t.test("single→multi rejects before real writer with no DB mutation", async () => {
      const action = findOutletFormAction(await pages.AddStock({ searchParams: Promise.resolve({}) }), "InventoryCommandForm");
      const second = await prisma.branch.create({ data: { businessId: business.id, name: "Second" } });
      const before = await snapshot(); await assert.rejects(action(stockData()), /changed/); assert.equal(await snapshot(), before);
      await prisma.branch.update({ where: { id: second.id }, data: { status: "INACTIVE" } });
    });
    await t.test("invalid/cross-Business explicit Branch cannot fallback", async () => {
      const action = findOutletFormAction(await pages.AddStock({ searchParams: Promise.resolve({}) }), "InventoryCommandForm");
      const before = await snapshot();
      for (const id of [foreignBranch.id, randomUUID(), ""]) { const data = stockData(); data.set("branchId", id); await assert.rejects(action(data), /changed/); }
      assert.equal(await snapshot(), before);
    });
    await t.test("fresh Business switch rejects saved stock and Product update pages", async () => {
      const add = findOutletFormAction(await pages.AddStock({ searchParams: Promise.resolve({}) }), "InventoryCommandForm");
      const update = findOutletFormAction(await pages.Detail({ params: Promise.resolve({ productId }) }), "ProductForm");
      const before = await snapshot();
      identity.businessId = foreign.id;
      await assert.rejects(add(stockData()));
      await assert.rejects(update(form({ productId, name: "Must not change", categoryId: category.id, price: "10" })));
      identity.businessId = business.id;
      assert.equal(await snapshot(), before);
      assert.notEqual((await prisma.product.findUniqueOrThrow({where:{id:productId}})).name, "Must not change");
    });
    await t.test("legacy new page accepts explicit authorized Branch and no-scope Staff fails closed", async () => {
      const second = await prisma.branch.create({ data: { businessId: business.id, name: "Legacy second" } });
      const action = findOutletFormAction(await pages.AddStock({ searchParams: Promise.resolve({branchId:second.id}) }), "InventoryCommandForm");
      const data = stockData(); data.set("branchId",second.id);
      await assert.rejects(action(data),/type=success/);
      assert.equal((await prisma.productStock.findUniqueOrThrow({where:{branchId_productId:{branchId:second.id,productId}}})).quantity,5);
      assert.equal(await prisma.inventoryMovement.count({where:{operationKey:String(data.get("operationKey")),branchId:second.id}}),1);
      const staff = await prisma.user.create({data:{businessId:business.id,role:"STAFF",name:"No branch Staff",permissions:["INVENTORY_MANAGE"]}});
      identity.userId=staff.id;
      const before=await snapshot();
      await assert.rejects(action(stockData()));
      const markup=renderToStaticMarkup(await pages.AddStock({searchParams:Promise.resolve({})}));
      assert.doesNotMatch(markup,/<form\b/);
      assert.equal(await snapshot(),before);
      identity.userId=owner.id;
      await prisma.branch.update({where:{id:second.id},data:{status:"INACTIVE"}});
    });
    await t.test("single to no-location rejects saved command and renders no executable form", async () => {
      const add=findOutletFormAction(await pages.AddStock({searchParams:Promise.resolve({})}),"InventoryCommandForm");
      await prisma.branch.update({where:{id:branch.id},data:{status:"INACTIVE"}});
      const before=await snapshot();
      await assert.rejects(add(stockData()),/changed/);
      const markup=renderToStaticMarkup(await pages.AddStock({searchParams:Promise.resolve({})}));
      assert.doesNotMatch(markup,/<form\b|name="branchId"/);
      assert.match(markup,/does not have an operating location set up yet/);
      assert.equal(await snapshot(),before);
      await prisma.branch.update({where:{id:branch.id},data:{status:"ACTIVE"}});
    });
    await t.test("permission revoked rejects saved page and idempotency replay", async () => {
      const staff = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, role: "STAFF", name: "Synthetic Staff", permissions: ["PRODUCTS", "INVENTORY_MANAGE"] } });
      identity.userId = staff.id;
      const action = findOutletFormAction(await pages.AddStock({ searchParams: Promise.resolve({}) }), "InventoryCommandForm");
      const data = stockData(); await assert.rejects(action(data), /type=success/);
      await prisma.user.update({ where: { id: staff.id }, data: { permissions: ["PRODUCTS"] } });
      const before = await snapshot(); await assert.rejects(action(data), /changed/); assert.equal(await snapshot(), before);
      identity.userId = owner.id;
    });
    await t.test("Quick Count stale revision and negative-stock protection remain effective", async () => {
      const countAction = findOutletFormAction(await pages.Count({ searchParams: Promise.resolve({ productId }) }), "InventoryCommandForm");
      const data = stockData(); data.delete("quantity"); data.set("delta", "-2"); data.set("expectedRevision", "0");
      const before = await snapshot(); await assert.rejects(countAction(data), /type=error/); assert.equal(await snapshot(), before);
      const remove = findOutletFormAction(await pages.Remove({ searchParams: Promise.resolve({ productId }) }), "InventoryCommandForm");
      const tooMuch = stockData(); tooMuch.set("quantity", "999"); await assert.rejects(remove(tooMuch), /type=error/); assert.equal(await snapshot(), before);
    });
    await t.test("no-location Product metadata may save, but no stock writer or branch ID is issued", async () => {
      const zero = await prisma.business.create({ data: { name: "Zero location", slug: `zero-${suffix}` } });
      const zeroOwner = await prisma.user.create({ data: { businessId: zero.id, name: "Zero Owner", role: "BUSINESS_OWNER" } });
      await prisma.businessModuleEntitlement.createMany({ data: ["POS", "INVENTORY"].map(moduleKey => ({ businessId: zero.id, moduleKey: moduleKey as "POS", status: "ENABLED" as const, source: "MANUAL" as const, enabledFrom: new Date(0) })) });
      const zeroCategory = await prisma.productCategory.create({ data: { businessId: zero.id, name: "Zero category" } });
      identity.businessId = zero.id; identity.userId = zeroOwner.id;
      const action = findOutletFormAction(await pages.Products({ searchParams: Promise.resolve({ modal: "create" }) }), "ProductCreateModal");
      await assert.rejects(action(form({ name: "Metadata only", categoryId: zeroCategory.id, price: "10", trackInventory: "on" })), /REDIRECT:\/products\//);
      assert.equal(await prisma.productStock.count({ where: { businessId: zero.id } }), 0);
      assert.equal(await prisma.inventoryMovement.count({ where: { businessId: zero.id } }), 0);
      const { resolveInventoryOutletWriteContext } = await importOutletUiContext();
      const context = await resolveInventoryOutletWriteContext({ businessId: zero.id, actorUserId: zeroOwner.id, capability: "MANAGE_INVENTORY" });
      assert.deepEqual(context, { kind: "no_location", businessId: zero.id });
    });
  } finally {
    delete (globalThis as Record<string, unknown>).__outletPageContext;
    await prisma.$disconnect();
  }
});

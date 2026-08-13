import assert from "node:assert/strict";
import { hash } from "bcryptjs";
import { PrismaClient, type BusinessIndustry } from "@prisma/client";
import { runManualInventoryMovement } from "../src/lib/inventory/service";
import { setReorderSettings } from "../src/lib/inventory/stock-count-service";

const prisma = new PrismaClient();

async function main() {
  assertLocalDatabase();
  const password = process.env.INVENTORY_PHASE3_QA_PASSWORD;
  assert.ok(password && password.length >= 9, "INVENTORY_PHASE3_QA_PASSWORD must be at least 9 characters.");
  const passwordHash = await hash(password, 12);
  const fixtures = [];
  for (const profile of [
    { code: "salon", industryType: "SALON_BEAUTY" as BusinessIndustry, name: "Inventory P3 QA Salon", primary: "QA Shampoo", positive: false },
    { code: "auto", industryType: "AUTO_DETAILING" as BusinessIndustry, name: "Inventory P3 QA Auto", primary: "QA Engine Oil", positive: true },
  ]) {
    const business = await prisma.business.upsert({ where: { slug: `inventory-p3-qa-${profile.code}` }, update: { industryType: profile.industryType, name: profile.name }, create: { industryType: profile.industryType, name: profile.name, slug: `inventory-p3-qa-${profile.code}` } });
    const branch = await prisma.branch.upsert({ where: { businessId_name: { businessId: business.id, name: "QA Main Branch" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "QA Main Branch" } });
    const counterEmail = `inventory.p3.${profile.code}.counter@local.test`; const approverEmail = `inventory.p3.${profile.code}.approver@local.test`;
    const counter = await prisma.user.upsert({ where: { email: counterEmail }, update: { branchId: branch.id, businessId: business.id, loginEnabled: true, name: "Inventory P3 Counter", passwordHash, role: "BUSINESS_OWNER", status: "active" }, create: { branchId: branch.id, businessId: business.id, email: counterEmail, loginEnabled: true, name: "Inventory P3 Counter", passwordHash, role: "BUSINESS_OWNER" } });
    const approver = await prisma.user.upsert({ where: { email: approverEmail }, update: { branchId: branch.id, businessId: business.id, loginEnabled: true, name: "Inventory P3 Approver", passwordHash, role: "BUSINESS_OWNER", status: "active" }, create: { branchId: branch.id, businessId: business.id, email: approverEmail, loginEnabled: true, name: "Inventory P3 Approver", passwordHash, role: "BUSINESS_OWNER" } });
    for (const moduleKey of ["POS", "INVENTORY"] as const) await prisma.businessModuleEntitlement.upsert({ where: { businessId_moduleKey: { businessId: business.id, moduleKey } }, update: { enabledFrom: new Date(), enabledUntil: null, status: "ENABLED", updatedById: approver.id }, create: { businessId: business.id, createdById: approver.id, enabledFrom: new Date(), moduleKey, source: "MANUAL", status: "ENABLED", updatedById: approver.id } });
    const primary = await prisma.product.upsert({ where: { businessId_name: { businessId: business.id, name: profile.primary } }, update: { status: "ACTIVE", trackInventory: true }, create: { businessId: business.id, costPrice: 8, name: profile.primary, price: 20, sku: `P3-${profile.code.toUpperCase()}-PRIMARY`, trackInventory: true } });
    const reorder = await prisma.product.upsert({ where: { businessId_name: { businessId: business.id, name: "QA Reorder Product" } }, update: { status: "ACTIVE", trackInventory: true }, create: { businessId: business.id, costPrice: 3, name: "QA Reorder Product", price: 10, sku: `P3-${profile.code.toUpperCase()}-REORDER`, trackInventory: true } });
    await ensureQuantity(business.id, branch.id, primary.id, approver.id, profile.positive ? 10 : 20, `${profile.code}:primary`);
    await ensureQuantity(business.id, branch.id, reorder.id, approver.id, 3, `${profile.code}:reorder`);
    const reorderStock = await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: branch.id, productId: reorder.id } } });
    await setReorderSettings({ actor: { email: approver.email, name: approver.name, userId: approver.id }, branchId: branch.id, businessId: business.id, expectedRevision: reorderStock.revision, operationKey: `P3_QA_REORDER_SETTINGS:${profile.code}:${reorderStock.revision}`, productId: reorder.id, reorderLevel: 5, targetStockLevel: 20 });
    await prisma.supplier.upsert({ where: { businessId_code: { businessId: business.id, code: "P3-QA" } }, update: { name: "Inventory P3 QA Supplier", status: "ACTIVE" }, create: { businessId: business.id, code: "P3-QA", name: "Inventory P3 QA Supplier" } });
    fixtures.push({ approverEmail, branch: branch.name, business: business.name, counterEmail, expectedActual: profile.positive ? 12 : 18, expectedSystem: profile.positive ? 10 : 20, primaryProduct: primary.name, reorderProduct: reorder.name });
  }
  console.log(JSON.stringify({ environment: "LOCAL_TESTING_ONLY", fixtures }, null, 2));
}

async function ensureQuantity(businessId: string, branchId: string, productId: string, actorUserId: string, desired: number, key: string) {
  const current = await prisma.productStock.findUnique({ where: { branchId_productId: { branchId, productId } }, select: { quantity: true } }); const delta = desired - (current?.quantity ?? 0); if (!delta) return;
  await runManualInventoryMovement({ actorUserId, branchId, businessId, operationKey: `P3_QA_FIXTURE:${key}:${Date.now()}`, productId, quantityDelta: delta, reason: "Local Inventory Phase 3 browser QA fixture", sourceId: productId, sourceType: "LOCAL_QA_FIXTURE", type: delta > 0 ? "STOCK_IN" : "STOCK_OUT" });
}
function assertLocalDatabase() { const host = new URL(process.env.DATABASE_URL ?? "").hostname; assert.ok(["127.0.0.1", "localhost", "::1"].includes(host), "LOCAL_DATABASE_REQUIRED"); }
main().finally(async () => prisma.$disconnect());

import bcrypt from "bcryptjs";
import { PrismaClient, type BusinessIndustry } from "@prisma/client";
import { runManualInventoryMovement } from "../src/lib/inventory/service";

const prisma = new PrismaClient();
const password = process.env.INVENTORY_P2_QA_PASSWORD ?? "";
if (!password || password.length < 9) throw new Error("INVENTORY_P2_QA_PASSWORD is required for Local browser fixtures.");
assertLocalDatabase();

async function main() {
for (const fixture of [
  { industry: "SALON_BEAUTY" as BusinessIndustry, label: "Salon", slug: "inventory-p2-salon-qa" },
  { industry: "AUTO_DETAILING" as BusinessIndustry, label: "Auto", slug: "inventory-p2-auto-qa" },
]) {
  const business = await prisma.business.upsert({ where: { slug: fixture.slug }, create: { industryType: fixture.industry, name: `Inventory P2 ${fixture.label} QA`, slug: fixture.slug }, update: { industryType: fixture.industry, status: "active" } });
  const branch = await prisma.branch.upsert({ where: { businessId_name: { businessId: business.id, name: `${fixture.label} Main` } }, create: { businessId: business.id, name: `${fixture.label} Main` }, update: { status: "ACTIVE" } });
  const passwordHash = await bcrypt.hash(password, 12);
  const creator = await prisma.user.upsert({ where: { email: `inventory.p2.${fixture.label.toLowerCase()}.creator@testing.local` }, create: { branchId: branch.id, businessId: business.id, email: `inventory.p2.${fixture.label.toLowerCase()}.creator@testing.local`, name: `${fixture.label} PO Creator`, passwordHash, role: "BUSINESS_OWNER" }, update: { branchId: branch.id, businessId: business.id, loginEnabled: true, passwordHash, role: "BUSINESS_OWNER", status: "active" } });
  await prisma.user.upsert({ where: { email: `inventory.p2.${fixture.label.toLowerCase()}.approver@testing.local` }, create: { branchId: branch.id, businessId: business.id, email: `inventory.p2.${fixture.label.toLowerCase()}.approver@testing.local`, name: `${fixture.label} PO Approver`, passwordHash, role: "BUSINESS_OWNER" }, update: { branchId: branch.id, businessId: business.id, loginEnabled: true, passwordHash, role: "BUSINESS_OWNER", status: "active" } });
  for (const moduleKey of ["POS", "INVENTORY"] as const) await prisma.businessModuleEntitlement.upsert({ where: { businessId_moduleKey: { businessId: business.id, moduleKey } }, create: { businessId: business.id, createdById: creator.id, enabledFrom: new Date(), moduleKey, source: "MANUAL", status: "ENABLED", updatedById: creator.id }, update: { enabledFrom: new Date(), enabledUntil: null, status: "ENABLED", updatedById: creator.id } });
  const product = await prisma.product.upsert({ where: { businessId_name: { businessId: business.id, name: `${fixture.label} QA Shampoo` } }, create: { businessId: business.id, costPrice: 8, name: `${fixture.label} QA Shampoo`, price: 20, sku: `P2-${fixture.label.toUpperCase()}-QA`, trackInventory: true }, update: { costPrice: 8, status: "ACTIVE", trackInventory: true } });
  await prisma.supplier.upsert({ where: { businessId_code: { businessId: business.id, code: `P2-${fixture.label.toUpperCase()}-SUP` } }, create: { businessId: business.id, code: `P2-${fixture.label.toUpperCase()}-SUP`, name: `${fixture.label} Supply QA` }, update: { name: `${fixture.label} Supply QA`, status: "ACTIVE" } });
  const stock = await prisma.productStock.findUnique({ where: { branchId_productId: { branchId: branch.id, productId: product.id } } });
  if (!stock) await runManualInventoryMovement({ actorUserId: creator.id, branchId: branch.id, businessId: business.id, operationKey: `P2_BROWSER_OPENING:${fixture.slug}`, productId: product.id, quantityDelta: 10, reason: "Inventory Phase 2 browser opening fixture", sourceId: product.id, sourceType: "TESTING_FIXTURE", type: "OPENING_BALANCE" });
}

await prisma.$disconnect();
console.log("Inventory Phase 2 Local browser fixtures ready.");
}

main().catch(async (error) => { await prisma.$disconnect(); throw error; });

function assertLocalDatabase() { const url = process.env.DATABASE_URL ?? ""; const host = new URL(url).hostname; if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Local database required."); }

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
  throw new Error("Inventory browser fixtures are restricted to the Local database.");
}

const password = process.env.LOCAL_INVENTORY_QA_PASSWORD;
if (!password || password.length < 12) {
  throw new Error("LOCAL_INVENTORY_QA_PASSWORD must contain at least 12 characters.");
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();
const runId = Date.now().toString();
const passwordHash = await bcrypt.hash(password, 12);
const enabledFrom = new Date("2026-01-01T00:00:00.000Z");

async function createProfile({ kind, industryType, modules, productName, sku, price }) {
  const slug = `inventory-qa-${kind}-${runId}`;
  const email = `inventory-${kind}-${runId}@test.local`;
  const business = await prisma.business.create({
    data: {
      name: `Inventory QA ${kind.toUpperCase()} ${runId}`,
      slug,
      industryType,
      timezone: "Asia/Kuala_Lumpur",
      sstEnabled: false,
    },
  });
  const mainBranch = await prisma.branch.create({
    data: { businessId: business.id, name: "Main Branch" },
  });
  const outletBranch = await prisma.branch.create({
    data: { businessId: business.id, name: "Outlet Branch" },
  });
  const owner = await prisma.user.create({
    data: {
      businessId: business.id,
      branchId: mainBranch.id,
      name: `Inventory QA ${kind.toUpperCase()} Owner`,
      email,
      passwordHash,
      role: "BUSINESS_OWNER",
      status: "active",
      loginEnabled: true,
    },
  });

  for (const moduleKey of modules) {
    const entitlement = await prisma.businessModuleEntitlement.create({
      data: {
        businessId: business.id,
        moduleKey,
        status: "ENABLED",
        enabledFrom,
        source: "SYSTEM",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.businessModuleEntitlementEvent.create({
      data: {
        entitlementId: entitlement.id,
        businessId: business.id,
        moduleKey,
        revision: 1,
        newStatus: "ENABLED",
        newEnabledFrom: enabledFrom,
        source: "SYSTEM",
        reason: "LOCAL / TESTING ONLY Inventory Phase 1 browser fixture.",
        actorUserId: owner.id,
      },
    });
  }

  const category = await prisma.productCategory.create({
    data: { businessId: business.id, name: "Inventory QA" },
  });
  const product = await prisma.product.create({
    data: {
      businessId: business.id,
      categoryId: category.id,
      category: category.name,
      name: `${productName} ${runId}`,
      sku: `${sku}-${runId}`,
      price,
      costPrice: "1.00",
      taxable: false,
      trackInventory: false,
    },
  });
  await prisma.cashierShift.create({
    data: {
      businessId: business.id,
      branchId: mainBranch.id,
      cashierId: owner.id,
      openingFloat: "0.00",
      notes: "LOCAL / TESTING ONLY Inventory Phase 1 browser fixture.",
    },
  });

  return {
    businessId: business.id,
    email,
    mainBranchId: mainBranch.id,
    outletBranchId: outletBranch.id,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
  };
}

try {
  const salon = await createProfile({
    kind: "salon",
    industryType: "SALON_BEAUTY",
    modules: ["POS", "SALON", "INVENTORY"],
    productName: "QA Shampoo",
    sku: "QA-SHAMPOO",
    price: "12.00",
  });
  const auto = await createProfile({
    kind: "auto",
    industryType: "AUTO_DETAILING",
    modules: ["POS", "AUTO", "INVENTORY"],
    productName: "QA Auto Part",
    sku: "QA-PART",
    price: "25.00",
  });
  console.log(JSON.stringify({ environment: "LOCAL / TESTING ONLY", runId, salon, auto }, null, 2));
} finally {
  await prisma.$disconnect();
}

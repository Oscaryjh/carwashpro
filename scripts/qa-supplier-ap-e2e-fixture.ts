import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {

const { prisma } = await import("../src/lib/prisma");
const { encryptMfaSecret } = await import("../src/lib/auth/mfa-crypto");
const { generateTotpCode, generateTotpSecret } = await import("../src/lib/auth/mfa-totp");

assertLocalDatabase();

const email = "ap-e2e@test.local";
const password = `Ap!${randomBytes(12).toString("base64url")}`;
const reviewerEmail = "ap-reviewer-e2e@test.local";
const reviewerPassword = `ApR!${randomBytes(12).toString("base64url")}`;
const branchStaffEmail = "ap-other-branch-e2e@test.local";
const branchStaffPassword = `ApB!${randomBytes(12).toString("base64url")}`;
const autoEmail = "ap-auto-e2e@test.local";
const autoPassword = `ApA!${randomBytes(12).toString("base64url")}`;
const passwordHash = await bcrypt.hash(password, 12);
const reviewerPasswordHash = await bcrypt.hash(reviewerPassword, 12);
const branchStaffPasswordHash = await bcrypt.hash(branchStaffPassword, 12);
const autoPasswordHash = await bcrypt.hash(autoPassword, 12);
const business = await prisma.business.upsert({
  where: { slug: "qa-supplier-ap-e2e" },
  update: { industryType: "SALON_BEAUTY", status: "active" },
  create: { name: "QA Supplier AP Salon", slug: "qa-supplier-ap-e2e", industryType: "SALON_BEAUTY" },
});
const branch = await prisma.branch.upsert({
  where: { businessId_name: { businessId: business.id, name: "QA Salon Branch" } },
  update: { status: "ACTIVE" },
  create: { businessId: business.id, name: "QA Salon Branch" },
});
const otherBranch = await prisma.branch.upsert({ where: { businessId_name: { businessId: business.id, name: "QA Other Branch" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "QA Other Branch" } });
const user = await prisma.user.upsert({
  where: { email },
  update: { branchId: branch.id, businessId: business.id, loginEnabled: true, name: "QA AP Owner", passwordHash, role: "BUSINESS_OWNER", status: "active" },
  create: { branchId: branch.id, businessId: business.id, email, loginEnabled: true, name: "QA AP Owner", passwordHash, role: "BUSINESS_OWNER", status: "active" },
});
await prisma.user.upsert({
  where: { email: reviewerEmail },
  update: { branchId: branch.id, businessId: business.id, loginEnabled: true, name: "QA AP Reviewer", passwordHash: reviewerPasswordHash, role: "BUSINESS_OWNER", status: "active" },
  create: { branchId: branch.id, businessId: business.id, email: reviewerEmail, loginEnabled: true, name: "QA AP Reviewer", passwordHash: reviewerPasswordHash, role: "BUSINESS_OWNER", status: "active" },
});
await prisma.user.upsert({
  where: { email: branchStaffEmail },
  update: { branchId: otherBranch.id, businessId: business.id, loginEnabled: true, name: "QA Other Branch AP", passwordHash: branchStaffPasswordHash, permissions: ["SUPPLIER_BILLS_VIEW", "ACCOUNTS_PAYABLE_VIEW"], role: "STAFF", status: "active" },
  create: { branchId: otherBranch.id, businessId: business.id, email: branchStaffEmail, loginEnabled: true, name: "QA Other Branch AP", passwordHash: branchStaffPasswordHash, permissions: ["SUPPLIER_BILLS_VIEW", "ACCOUNTS_PAYABLE_VIEW"], role: "STAFF", status: "active" },
});
for (const moduleKey of ["POS", "SALON", "INVENTORY"] as const) {
  const entitlement = await prisma.businessModuleEntitlement.findUnique({ where: { businessId_moduleKey: { businessId: business.id, moduleKey } } });
  if (!entitlement) await prisma.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey, enabledFrom: new Date("2026-01-01T00:00:00Z"), source: "MANUAL", status: "ENABLED", createdById: user.id, updatedById: user.id } });
}
const product = await prisma.product.upsert({
  where: { businessId_sku: { businessId: business.id, sku: "QA-AP-PRODUCT" } },
  update: { costPrice: 20, name: "QA AP Salon Product", price: 35, status: "ACTIVE", trackInventory: true },
  create: { businessId: business.id, costPrice: 20, name: "QA AP Salon Product", price: 35, sku: "QA-AP-PRODUCT", status: "ACTIVE", trackInventory: true },
});

const autoBusiness = await prisma.business.upsert({ where: { slug: "qa-supplier-ap-auto-e2e" }, update: { industryType: "AUTO_DETAILING", status: "active" }, create: { name: "QA Supplier AP Auto", slug: "qa-supplier-ap-auto-e2e", industryType: "AUTO_DETAILING" } });
const autoBranch = await prisma.branch.upsert({ where: { businessId_name: { businessId: autoBusiness.id, name: "QA Auto Branch" } }, update: { status: "ACTIVE" }, create: { businessId: autoBusiness.id, name: "QA Auto Branch" } });
const autoUser = await prisma.user.upsert({ where: { email: autoEmail }, update: { branchId: autoBranch.id, businessId: autoBusiness.id, loginEnabled: true, name: "QA Auto AP Owner", passwordHash: autoPasswordHash, role: "BUSINESS_OWNER", status: "active" }, create: { branchId: autoBranch.id, businessId: autoBusiness.id, email: autoEmail, loginEnabled: true, name: "QA Auto AP Owner", passwordHash: autoPasswordHash, role: "BUSINESS_OWNER", status: "active" } });
for (const moduleKey of ["POS", "AUTO", "INVENTORY"] as const) {
  const entitlement = await prisma.businessModuleEntitlement.findUnique({ where: { businessId_moduleKey: { businessId: autoBusiness.id, moduleKey } } });
  if (!entitlement) await prisma.businessModuleEntitlement.create({ data: { businessId: autoBusiness.id, moduleKey, enabledFrom: new Date("2026-01-01T00:00:00Z"), source: "MANUAL", status: "ENABLED", createdById: autoUser.id, updatedById: autoUser.id } });
}

await prisma.userMfaCredential.deleteMany({ where: { userId: user.id } });
const credentialId = randomUUID();
const secret = generateTotpSecret();
const encrypted = encryptMfaSecret(secret, { credentialId, userId: user.id, type: "TOTP" });
await prisma.userMfaCredential.create({ data: { id: credentialId, userId: user.id, type: "TOTP", status: "ACTIVE", ...encrypted, algorithm: "SHA1", digits: 6, periodSeconds: 30, enrolledAt: new Date(), verifiedAt: new Date() } });

console.log(JSON.stringify({
  environment: "LOCAL_TESTING_ONLY",
  email,
  password,
  reviewerEmail,
  reviewerPassword,
  branchStaffEmail,
  branchStaffPassword,
  autoEmail,
  autoPassword,
  currentTotp: generateTotpCode({ secret, timestamp: Date.now() }),
  businessId: business.id,
  branchId: branch.id,
  otherBranchId: otherBranch.id,
  autoBusinessId: autoBusiness.id,
  productId: product.id,
}, null, 2));
await prisma.$disconnect();
}

function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("QA Supplier AP fixture requires a Local database.");
}

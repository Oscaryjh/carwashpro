import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { ensureStarterExpenseCategories } from "../src/lib/expense/service";

async function main() {
  const prisma = new PrismaClient();
  try {
    const password = process.env.LOCAL_QA_PASSWORD;
    if (!password || password.length < 9) throw new Error("LOCAL_QA_PASSWORD (9+ characters) is required for Local browser fixtures.");
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Expense browser fixtures are Local/Testing only.");

    const token = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    const passwordHash = await bcrypt.hash(password, 12);
    const output: Record<string, unknown> = { token };

    for (const variant of [
      { industryType: "SALON_BEAUTY" as const, key: "salon", label: "Salon" },
      { industryType: "AUTO_DETAILING" as const, key: "auto", label: "Auto" },
    ]) {
      const business = await prisma.business.create({ data: { industryType: variant.industryType, name: `Expense P1 QA ${variant.label} ${token}`, slug: `expense-p1-qa-${variant.key}-${token}` } });
      const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Lintas" } });
      const email = `expense.p1.${variant.key}.${token}@local.test`;
      const user = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email, loginEnabled: true, name: `Expense P1 ${variant.label} Owner`, passwordHash, role: "BUSINESS_OWNER", status: "active" } });
      await prisma.businessModuleEntitlement.create({ data: { businessId: business.id, createdById: user.id, enabledFrom: new Date(), moduleKey: "EXPENSE", source: "MANUAL", status: "ENABLED", updatedById: user.id } });
      await ensureStarterExpenseCategories(business.id, prisma);
      output[variant.key] = { branchId: branch.id, businessId: business.id, email, marketingCategoryId: (await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Marketing" } })).id, utilitiesCategoryId: (await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Utilities" } })).id };
    }

    console.log(JSON.stringify(output));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Expense browser fixture preparation failed.");
  process.exitCode = 1;
});

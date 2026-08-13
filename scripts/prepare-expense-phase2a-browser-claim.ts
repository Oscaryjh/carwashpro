import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { submitEmployeeClaim } from "../src/lib/claim/service";

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("Expense Phase 2A browser Claim fixture is Local/Testing only.");
  }

  const prisma = new PrismaClient();
  try {
    const business = await prisma.business.findFirstOrThrow({
      where: { name: { startsWith: "Expense P2A " } },
      orderBy: { createdAt: "desc" },
      include: {
        branches: { take: 1 },
        employeeMemberships: { where: { status: "ACTIVE" }, take: 1 },
      },
    });
    const branch = business.branches[0];
    const membership = business.employeeMemberships[0];
    if (!branch || !membership) throw new Error("Latest Expense P2A fixture is missing its branch or employee.");
    const category = await prisma.claimCategory.findFirstOrThrow({
      where: { businessId: business.id, code: "MILEAGE", active: true },
    });
    const claim = await submitEmployeeClaim({
      attendanceBranchId: branch.id,
      businessId: business.id,
      deviceId: randomUUID(),
      employeeAccountId: membership.employeeAccountId,
      membershipId: membership.id,
      primaryBranchId: branch.id,
      sessionId: randomUUID(),
    }, {
      clientRequestId: randomUUID(),
      currency: "MYR",
      purpose: "Local browser Expense Phase 2A partial approval",
      lines: [{
        amount: "120.00",
        categoryId: category.id,
        description: "Local browser reimbursement fixture",
        expenseDate: "2026-08-11",
        lineNumber: 1,
        merchant: "Local QA Merchant",
        mileageKm: "141.18",
      }],
    }, [], { database: prisma });
    console.log(JSON.stringify({ businessId: business.id, claimId: claim.id, claimNumber: claim.claimNumber, environment: "LOCAL_TESTING" }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Expense Phase 2A browser Claim fixture failed.");
  process.exitCode = 1;
});

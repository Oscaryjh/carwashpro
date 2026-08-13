import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("Expense Phase 2A browser login is Local/Testing only.");
  }
  const password = process.env.LOCAL_QA_PASSWORD;
  if (!password || password.length < 9) {
    throw new Error("LOCAL_QA_PASSWORD (9+ characters) is required.");
  }

  const prisma = new PrismaClient();
  try {
    const business = await prisma.business.findFirstOrThrow({
      where: { name: { startsWith: "Expense P2A " } },
      orderBy: { createdAt: "desc" },
      include: { users: { where: { role: "BUSINESS_OWNER" }, take: 1 } },
    });
    const owner = business.users[0];
    if (!owner?.email) throw new Error("Latest Expense P2A fixture has no business owner login.");
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        loginEnabled: true,
        passwordHash: await bcrypt.hash(password, 12),
        status: "active",
      },
    });
    console.log(JSON.stringify({ businessId: business.id, email: owner.email, environment: "LOCAL_TESTING" }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Expense Phase 2A browser login setup failed.");
  process.exitCode = 1;
});

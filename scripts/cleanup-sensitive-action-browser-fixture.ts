import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const emails = [
  "step-up-authorised@test.local",
  "step-up-unauthorised@test.local",
];

async function main() {
  assertLocalDatabase();
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length) {
    await prisma.authSecurityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.sensitiveActionAuthorization.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    cleanedUsers: userIds.length,
  }));
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main().finally(() => prisma.$disconnect());

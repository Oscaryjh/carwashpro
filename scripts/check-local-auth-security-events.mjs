import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname;
if (!["localhost", "127.0.0.1"].includes(hostname)) {
  throw new Error("Auth security diagnostics are restricted to Local database.");
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();

try {
  if (process.argv.includes("--qa-password-candidate")) {
    const candidate = process.env.LOCAL_QA_PASSWORD_CANDIDATE;
    if (!candidate) throw new Error("LOCAL_QA_PASSWORD_CANDIDATE is required.");
    const users = await prisma.user.findMany({
      where: {
        business: { name: { in: ["QA SALON 35b0d691", "QA AUTO 35b0d691"] } },
        passwordHash: { not: null },
      },
      select: { name: true, passwordHash: true },
      orderBy: { name: "asc" },
    });
    const matches = [];
    for (const user of users) {
      if (user.passwordHash && (await bcrypt.compare(candidate, user.passwordHash))) {
        matches.push(user.name);
      }
    }
    console.log(JSON.stringify({ matchingQaUsers: matches }, null, 2));
  } else if (process.argv.includes("--qa-users")) {
    const qaUsers = await prisma.user.findMany({
      where: {
        business: { name: { in: ["QA SALON 35b0d691", "QA AUTO 35b0d691"] } },
      },
      select: {
        name: true,
        email: true,
        role: true,
        loginEnabled: true,
        permissions: true,
        business: { select: { name: true, industryType: true } },
      },
      orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
    });
    console.log(JSON.stringify(qaUsers, null, 2));
    process.exitCode = 0;
  } else {
  const since = new Date(Date.now() - 60 * 60 * 1_000);
  const events = await prisma.authSecurityEvent.groupBy({
    by: ["surface", "eventType", "outcome"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: [{ surface: "asc" }, { eventType: "asc" }],
  });
  console.log(JSON.stringify(events, null, 2));
  }
} finally {
  await prisma.$disconnect();
}

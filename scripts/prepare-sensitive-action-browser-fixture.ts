import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const authorisedEmail = "step-up-authorised@test.local";
const unauthorisedEmail = "step-up-unauthorised@test.local";

async function main() {
  assertLocalDatabase();
  const password = process.env.STEP_UP_QA_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("STEP_UP_QA_PASSWORD_REQUIRED");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const authorised = await prisma.user.upsert({
    where: { email: authorisedEmail },
    update: {
      name: "Step-up Authorised QA",
      passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: ["SENSITIVE_ACTION_QA"],
      status: "active",
      loginEnabled: true,
      businessId: null,
      branchId: null,
    },
    create: {
      name: "Step-up Authorised QA",
      email: authorisedEmail,
      passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: ["SENSITIVE_ACTION_QA"],
    },
  });
  const unauthorised = await prisma.user.upsert({
    where: { email: unauthorisedEmail },
    update: {
      name: "Step-up Unauthorised QA",
      passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: [],
      status: "active",
      loginEnabled: true,
      businessId: null,
      branchId: null,
    },
    create: {
      name: "Step-up Unauthorised QA",
      email: unauthorisedEmail,
      passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: [],
    },
  });
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    authorisedEmail,
    unauthorisedEmail,
    authorisedUserId: authorised.id,
    unauthorisedUserId: unauthorised.id,
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

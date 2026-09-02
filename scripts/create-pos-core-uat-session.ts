import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  createSessionToken,
  persistSessionContext,
  SESSION_CONTEXT_VERSION,
} from "../src/lib/auth/session";

const prisma = new PrismaClient();
const OUTPUT = join(process.cwd(), ".tmp", "pos-core-uat-session.json");

function assertLocal() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("POS_CORE_UAT_SESSION_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(hostname)) {
    throw new Error("POS_CORE_UAT_SESSION_REQUIRES_LOCAL_DATABASE");
  }
  process.env.SESSION_SECRET ??= "tetamu-local-development-session-secret-v1";
}

async function main() {
  assertLocal();
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email?.endsWith("@tetamu.test")) {
    throw new Error("POS_CORE_UAT_EMAIL_REQUIRED");
  }
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: {
      id: true,
      businessId: true,
      branchId: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      status: true,
    },
  });
  if (!user.businessId || !user.email) {
    throw new Error("POS_CORE_UAT_USER_CONTEXT_REQUIRED");
  }
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: user.businessId },
    select: { industryType: true },
  });
  const session = {
    userId: user.id,
    sessionId: randomUUID(),
    homeBusinessId: user.businessId,
    activeBusinessId: user.businessId,
    contextVersion: SESSION_CONTEXT_VERSION,
    industryType: business.industryType,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  };
  const token = await createSessionToken(session);
  await persistSessionContext(session);
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({ token }), "utf8");
  console.log(`POS Core UAT session ready for ${email}.`);
  console.log(`Artifact: ${OUTPUT}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

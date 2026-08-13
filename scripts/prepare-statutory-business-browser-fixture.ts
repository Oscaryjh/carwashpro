import { hash } from "bcryptjs";
import { prisma } from "../src/lib/prisma";

const email = "statutory-business.qa@test.local";
const slug = "statutory-browser-security-qa";

async function main() {
  assertLocal();
  const password = process.env.STATUTORY_BROWSER_QA_PASSWORD;
  if (!password || password.length < 12) throw new Error("STATUTORY_BROWSER_QA_PASSWORD_REQUIRED");
  const business = await prisma.business.upsert({
    where: { slug },
    create: { name: "Statutory Browser Security QA", slug },
    update: { status: "active" },
  });
  await prisma.user.upsert({
    where: { email },
    create: {
      businessId: business.id,
      name: "Statutory Business QA",
      email,
      passwordHash: await hash(password, 12),
      role: "BUSINESS_OWNER",
    },
    update: {
      businessId: business.id,
      passwordHash: await hash(password, 12),
      role: "BUSINESS_OWNER",
      loginEnabled: true,
      status: "active",
      permissions: [],
    },
  });
  console.log(JSON.stringify({ environment: "LOCAL / TESTING ONLY", email, businessId: business.id }));
}

function assertLocal() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("LOCAL_DATABASE_URL_REQUIRED");
  const host = new URL(value).hostname;
  if (process.env.NODE_ENV === "production" || !new Set(["localhost", "127.0.0.1", "::1"]).has(host)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());

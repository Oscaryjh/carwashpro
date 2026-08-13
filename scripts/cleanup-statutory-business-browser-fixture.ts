import { prisma } from "../src/lib/prisma";

async function main() {
  const value = process.env.DATABASE_URL;
  if (!value || process.env.NODE_ENV === "production" ||
    !new Set(["localhost", "127.0.0.1", "::1"]).has(new URL(value).hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
  const business = await prisma.business.findUnique({
    where: { slug: "statutory-browser-security-qa" }, select: { id: true },
  });
  if (business) {
    await prisma.user.deleteMany({ where: { businessId: business.id, email: "statutory-business.qa@test.local" } });
    await prisma.auditLog.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
  }
  console.log(JSON.stringify({ environment: "LOCAL / TESTING ONLY", cleaned: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());

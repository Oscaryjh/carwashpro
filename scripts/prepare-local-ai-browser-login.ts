import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) || process.env.NODE_ENV === "production") {
    throw new Error("AI browser login preparation is Local / Testing only.");
  }
  const email = process.env.LOCAL_AI_QA_EMAIL;
  const password = process.env.LOCAL_AI_QA_PASSWORD;
  if (!email || !password || password.length < 9) throw new Error("LOCAL_AI_QA_EMAIL and LOCAL_AI_QA_PASSWORD (9+ characters) are required.");
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, businessId: true } });
  if (!user.businessId) throw new Error("The Local AI QA account must be business-bound.");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12), loginEnabled: true, status: "active" } });
  process.stdout.write(`Prepared Local / Testing AI QA login for ${email}.\n`);
}

main().finally(() => prisma.$disconnect());

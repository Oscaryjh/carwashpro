import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: {
      name: "Platform Admin",
      passwordHash,
      role: UserRole.PLATFORM_ADMIN,
      status: "active",
      businessId: null,
    },
    create: {
      name: "Platform Admin",
      email,
      passwordHash,
      role: UserRole.PLATFORM_ADMIN,
      status: "active",
      businessId: null,
    },
  });

  console.log(`Seeded platform admin: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient, UserRole, type BusinessIndustry } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY,
} from "../src/lib/whatsapp/template-defaults";

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

  const seededTemplates = Object.entries(
    DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY,
  ).flatMap(([industryType, templates]) =>
    templates.map((template) => ({
      industryType: industryType as BusinessIndustry,
      template,
    })),
  );

  await Promise.all(
    seededTemplates.map(({ industryType, template }) =>
      prisma.whatsAppTemplate.upsert({
        where: {
          messageType_industryType: {
            industryType,
            messageType: template.messageType,
          },
        },
        update: {},
        create: {
          body: template.body,
          industryType,
          messageType: template.messageType,
          status: "ACTIVE",
          title: template.title,
        },
      }),
    ),
  );

  console.log(`Seeded WhatsApp templates: ${seededTemplates.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

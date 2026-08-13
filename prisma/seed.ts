import { PrismaClient, UserRole, type BusinessIndustry } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY,
} from "../src/lib/whatsapp/template-defaults";
import { createCommercialPlan, createCommercialPlanVersion, activateCommercialPlanVersion } from "../src/lib/commercial/service";
import { isProductionRuntime } from "../src/lib/release/environment";

const prisma = new PrismaClient();

async function main() {
  const production = isProductionRuntime();
  if (production && process.env.ALLOW_PRODUCTION_PLATFORM_ADMIN_BOOTSTRAP !== "true") {
    throw new Error("Production seed is disabled. Use the explicit one-time Platform Admin bootstrap contract.");
  }

  const email = (process.env.SEED_ADMIN_EMAIL ?? (production ? "" : "admin@example.com")).trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? (production ? "" : "LOCAL_ONLY_CHANGE_ME");
  if (!email || !password || (production && password.length < 16)) {
    throw new Error("Production Platform Admin bootstrap requires explicit email and a password of at least 16 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (production && await prisma.user.findFirst({ where: { role: UserRole.PLATFORM_ADMIN } })) {
    throw new Error("Production Platform Admin already exists; refusing to rotate credentials through seed.");
  }
  if (production && await prisma.user.findUnique({ where: { email } })) {
    throw new Error("Production bootstrap email already belongs to a user; refusing to change that identity through seed.");
  }

  const platformAdmin = await prisma.user.upsert({
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

  if (production) {
    console.log("Production one-time Platform Admin bootstrap complete; no QA/templates/commercial seed data was created.");
    return;
  }

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

  if (process.env.NODE_ENV !== "production" && process.env.SEED_COMMERCIAL_PLANS === "true") {
    const actor = { userId: platformAdmin.id, name: platformAdmin.name, email: platformAdmin.email!, role: platformAdmin.role, status: platformAdmin.status, permissions: [], homeBusinessId: null, activeBusinessId: null, businessId: null, contextVersion: 1 };
    const seeds = [
      { code: "TETAMU_BUSINESS", displayName: "Tetamu Business", planType: "BASE" as const, monthly: 9_900, annual: 99_000, ai: 20, modules: ["POS", "AI"] as const },
      { code: "TETAMU_OPERATIONS", displayName: "Tetamu Operations", planType: "BASE" as const, monthly: 16_900, annual: 169_000, ai: 50, modules: ["POS", "INVENTORY", "EXPENSE", "AI"] as const },
      { code: "WORKFORCE_ADDON", displayName: "Workforce Add-on", planType: "ADD_ON" as const, monthly: 5_900, annual: 59_000, ai: 0, modules: ["HR", "CLAIMS"] as const },
      { code: "ASK_TETAMU_ADDON", displayName: "Ask Tetamu Business Add-on", planType: "ADD_ON" as const, monthly: 3_900, annual: 39_000, ai: 300, modules: ["AI"] as const },
      { code: "AI_POWER_ADDON", displayName: "Ask Tetamu Power Add-on", planType: "ADD_ON" as const, monthly: 7_900, annual: 79_000, ai: 1_000, modules: ["AI"] as const },
    ];
    for (const seed of seeds) {
      const existing = await prisma.commercialPlan.findUnique({ where: { code: seed.code } });
      if (existing) continue;
      const plan = await createCommercialPlan(actor, { ...seed, scopeType: "BUSINESS", operationKey: `LOCAL-SEED:PLAN:${seed.code}` });
      const draft = await createCommercialPlanVersion(actor, { planId: plan.id, operationKey: `LOCAL-SEED:VERSION:${seed.code}`, effectiveFrom: new Date("2026-08-01T00:00:00Z"), monthlyListPriceCents: seed.monthly, annualListPriceCents: seed.annual, setupFeeCents: seed.planType === "BASE" ? 30_000 : 0, includedBranches: seed.planType === "BASE" ? 1 : 0, includedEmployees: seed.code === "WORKFORCE_ADDON" ? 10 : 0, extraBranchUnitPriceCents: seed.planType === "BASE" ? 3_900 : null, extraEmployeeUnitPriceCents: seed.code === "WORKFORCE_ADDON" ? 400 : null, businessAiAllowance: seed.ai, groupAiAllowance: null, modules: [...seed.modules] });
      await activateCommercialPlanVersion(actor, draft.id, `LOCAL-SEED:ACTIVATE:${seed.code}`);
    }
    console.log("Seeded Local/Testing commercial catalog. Payroll commercial availability remains disabled/review-required.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
if (!['localhost', '127.0.0.1'].includes(new URL(configuredUrl).hostname)) {
  throw new Error('Module entitlement QA fixture operations are restricted to the Local database.');
}
const password = process.env.LOCAL_MODULE_QA_PASSWORD;
if (!password || password.length < 12) {
  throw new Error('LOCAL_MODULE_QA_PASSWORD must contain at least 12 characters.');
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();
const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
const managedModules = [
  'POS',
  'SALON',
  'AUTO',
  'WHATSAPP',
  'BUSINESS_GROUP',
  'HR',
  'PAYROLL',
  'STATUTORY',
];
const profiles = [
  {
    key: 'POS_ONLY_SALON',
    slug: 'qa-module-pos-only-salon',
    name: 'QA MODULE POS ONLY SALON',
    email: 'module-pos-owner@test.local',
    industryType: 'SALON_BEAUTY',
    enabled: new Set(['POS', 'SALON']),
  },
  {
    key: 'HR_ONLY',
    slug: 'qa-module-hr-only',
    name: 'QA MODULE HR ONLY',
    email: 'module-hr-owner@test.local',
    industryType: 'GENERAL_SERVICE',
    enabled: new Set(['HR']),
  },
  {
    key: 'FULL_BUSINESS',
    slug: 'qa-module-full-business',
    name: 'QA MODULE FULL BUSINESS',
    email: 'module-full-owner@test.local',
    industryType: 'SALON_BEAUTY',
    enabled: new Set(['POS', 'SALON', 'AUTO', 'WHATSAPP', 'HR', 'PAYROLL', 'STATUTORY']),
  },
];

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const results = [];
  for (const profile of profiles) {
    const business = await prisma.business.upsert({
      where: { slug: profile.slug },
      create: {
        name: profile.name,
        slug: profile.slug,
        industryType: profile.industryType,
        timezone: 'Asia/Kuala_Lumpur',
      },
      update: {
        name: profile.name,
        industryType: profile.industryType,
        status: 'active',
        timezone: 'Asia/Kuala_Lumpur',
      },
    });
    const branch = await prisma.branch.upsert({
      where: { businessId_name: { businessId: business.id, name: 'QA Main Branch' } },
      create: { businessId: business.id, name: 'QA Main Branch' },
      update: { status: 'ACTIVE' },
    });
    const owner = await prisma.user.upsert({
      where: { email: profile.email },
      create: {
        businessId: business.id,
        branchId: branch.id,
        name: `${profile.key} Owner`,
        email: profile.email,
        passwordHash,
        loginEnabled: true,
        role: 'BUSINESS_OWNER',
        status: 'active',
      },
      update: {
        businessId: business.id,
        branchId: branch.id,
        passwordHash,
        loginEnabled: true,
        role: 'BUSINESS_OWNER',
        status: 'active',
      },
    });

    for (const moduleKey of managedModules) {
      const status = profile.enabled.has(moduleKey) ? 'ENABLED' : 'DISABLED';
      const current = await prisma.businessModuleEntitlement.findUnique({
        where: { businessId_moduleKey: { businessId: business.id, moduleKey } },
      });
      if (current?.status === status && current.enabledFrom.getTime() === effectiveFrom.getTime()) {
        continue;
      }
      const revision = current ? current.revision + 1 : 1;
      const entitlement = current
        ? await prisma.businessModuleEntitlement.update({
            where: { id: current.id },
            data: {
              status,
              enabledFrom: effectiveFrom,
              enabledUntil: null,
              source: 'SYSTEM',
              revision,
              updatedById: owner.id,
            },
          })
        : await prisma.businessModuleEntitlement.create({
            data: {
              businessId: business.id,
              moduleKey,
              status,
              enabledFrom: effectiveFrom,
              source: 'SYSTEM',
              createdById: owner.id,
              updatedById: owner.id,
            },
          });
      await prisma.businessModuleEntitlementEvent.create({
        data: {
          entitlementId: entitlement.id,
          businessId: business.id,
          moduleKey,
          revision,
          oldStatus: current?.status ?? null,
          newStatus: status,
          oldEnabledFrom: current?.enabledFrom ?? null,
          newEnabledFrom: effectiveFrom,
          oldEnabledUntil: current?.enabledUntil ?? null,
          newEnabledUntil: null,
          source: 'SYSTEM',
          reason: 'Deterministic Local browser entitlement QA profile.',
          actorUserId: owner.id,
        },
      });
    }
    results.push({ profile: profile.key, businessId: business.id, email: profile.email });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await prisma.$disconnect();
}

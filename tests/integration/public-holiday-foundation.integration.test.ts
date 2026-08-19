import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { importOfficialHolidayCalendar, previewOfficialHolidayCalendar, resolveBranchHolidays } from "../../src/lib/holidays/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("canonical holiday resolver isolates tenant, state and branch applicability", async () => {
  assertLocalDatabase();
  const rollback = Symbol("rollback");
  await assert.rejects(prisma.$transaction(async (transaction) => {
    const token = Date.now();
    const business = await transaction.business.create({ data: { name: `Holiday QA ${token}`, slug: `holiday-qa-${token}` } });
    const otherBusiness = await transaction.business.create({ data: { name: `Holiday Other ${token}`, slug: `holiday-other-${token}` } });
    const sabah = await transaction.branch.create({ data: { businessId: business.id, name: "Sabah QA", countryCode: "MY", stateCode: "SBH" } });
    const kl = await transaction.branch.create({ data: { businessId: business.id, name: "KL QA", countryCode: "MY", stateCode: "KUL" } });
    const otherSabah = await transaction.branch.create({ data: { businessId: otherBusiness.id, name: "Other Sabah", countryCode: "MY", stateCode: "SBH" } });
    const actor = await transaction.user.create({ data: { businessId: business.id, branchId: sabah.id, name: "Holiday Manager", email: `holiday-${token}@example.test`, role: "BUSINESS_OWNER" } });
    const otherActor = await transaction.user.create({ data: { businessId: otherBusiness.id, branchId: otherSabah.id, name: "Other Holiday Manager", email: `holiday-other-${token}@example.test`, role: "BUSINESS_OWNER" } });
    const date = new Date("2026-08-31T00:00:00.000Z");
    const common = { workDate: date, holidayType: "PUBLIC_HOLIDAY" as const, source: "OFFICIAL" as const, statutory: true, officialReference: "https://www.kabinet.gov.my/", createdById: actor.id };
    await transaction.holidayOccurrence.createMany({ data: [
      { ...common, businessId: business.id, name: "National Day", scope: "NATIONAL", countryCode: "MY" },
      { ...common, businessId: business.id, name: "Sabah Holiday", scope: "STATE", countryCode: "MY", stateCode: "SBH" },
      { ...common, businessId: business.id, name: "Business Closure", scope: "BUSINESS", countryCode: "MY", source: "CUSTOM", statutory: false, officialReference: null },
      { ...common, businessId: business.id, branchId: sabah.id, name: "Sabah Branch Day", scope: "BRANCH", countryCode: "MY", source: "CUSTOM", statutory: false, officialReference: null },
      { ...common, businessId: otherBusiness.id, branchId: otherSabah.id, name: "Other Tenant Holiday", scope: "BRANCH", countryCode: "MY", source: "CUSTOM", statutory: false, officialReference: null, createdById: otherActor.id },
    ] });

    const sabahResult = await resolveBranchHolidays({ businessId: business.id, branchId: sabah.id, from: date, to: date, database: transaction });
    assert.deepEqual(sabahResult.map((item) => item.name).sort(), ["Business Closure", "National Day", "Sabah Branch Day", "Sabah Holiday"]);
    assert.equal(sabahResult.some((item) => item.name === "Other Tenant Holiday"), false);

    const klResult = await resolveBranchHolidays({ businessId: business.id, branchId: kl.id, from: date, to: date, database: transaction });
    assert.deepEqual(klResult.map((item) => item.name).sort(), ["Business Closure", "National Day"]);

    await assert.rejects(
      resolveBranchHolidays({ businessId: otherBusiness.id, branchId: sabah.id, from: date, to: date, database: transaction }),
      /not available/,
    );
    throw rollback;
  }, { isolationLevel: "Serializable", timeout: 30_000 }), (error: unknown) => error === rollback);
});

test("Sabah official calendar import is tenant-scoped and idempotent", async () => {
  assertLocalDatabase();
  const rollback = Symbol("rollback");
  await assert.rejects(prisma.$transaction(async (transaction) => {
    const token = Date.now();
    const business = await transaction.business.create({ data: { name: `Holiday Import QA ${token}`, slug: `holiday-import-${token}` } });
    const otherBusiness = await transaction.business.create({ data: { name: `Holiday Import Other ${token}`, slug: `holiday-import-other-${token}` } });
    const branch = await transaction.branch.create({ data: { businessId: business.id, name: "Sabah Import QA", countryCode: "MY", stateCode: "SBH" } });
    const otherBranch = await transaction.branch.create({ data: { businessId: otherBusiness.id, name: "Other Sabah Import QA", countryCode: "MY", stateCode: "SBH" } });
    const actor = await transaction.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Holiday Import Manager", email: `holiday-import-${token}@example.test`, role: "BUSINESS_OWNER" } });
    const date = new Date("2026-08-31T00:00:00.000Z");
    await transaction.holidayOccurrence.create({ data: { businessId: business.id, workDate: date, name: "National Day", holidayType: "PUBLIC_HOLIDAY", source: "OFFICIAL", scope: "NATIONAL", countryCode: "MY", statutory: true, officialReference: "https://sabah.gov.my/public-holidays", createdById: actor.id } });

    const context = { businessId: business.id, allowedBranchIds: [branch.id], actor: { userId: actor.id, name: actor.name, email: actor.email! }, countryCode: "MY", stateCode: "SBH", year: 2026 } as const;
    const first = await importOfficialHolidayCalendar({ ...context, database: transaction });
    assert.equal(first.createdCount, 20);
    const preview = await previewOfficialHolidayCalendar({ businessId: business.id, countryCode: "MY", stateCode: "SBH", year: 2026, database: transaction });
    assert.equal(preview?.installedCount, 21);
    assert.equal(preview?.missingCount, 0);
    const second = await importOfficialHolidayCalendar({ ...context, database: transaction });
    assert.equal(second.createdCount, 0);
    assert.equal(await transaction.holidayOccurrence.count({ where: { businessId: business.id } }), 21);
    assert.equal(await transaction.holidayOccurrence.count({ where: { businessId: otherBusiness.id } }), 0);
    assert.equal(await transaction.holidayOccurrence.count({ where: { businessId: otherBusiness.id, branchId: otherBranch.id } }), 0);
    throw rollback;
  }, { isolationLevel: "Serializable", timeout: 30_000 }), (error: unknown) => error === rollback);
});

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Public Holiday integration tests.");
  const hostname = new URL(databaseUrl).hostname;
  if (!new Set(["localhost", "127.0.0.1"]).has(hostname)) throw new Error("Public Holiday integration tests are restricted to Local / Testing database hosts.");
}

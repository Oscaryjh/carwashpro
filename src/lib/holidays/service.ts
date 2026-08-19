import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { dateValue } from "@/lib/roster/domain";
import { holidayAppliesToBranch, holidayInputSchema, type ResolvedHoliday } from "./domain";
import { getOfficialHolidayCatalog, officialHolidayKey } from "./malaysia-official-calendar";

type HolidayDatabase = PrismaClient | Prisma.TransactionClient;
type HolidayActor = Pick<AppSession, "userId" | "name" | "email">;

export async function resolveBranchHolidays(args: {
  businessId: string;
  branchId: string;
  from: Date;
  to: Date;
  database?: HolidayDatabase;
}): Promise<ResolvedHoliday[]> {
  const database = args.database ?? prisma;
  const branch = await database.branch.findFirst({
    where: { id: args.branchId, businessId: args.businessId, status: "ACTIVE" },
    select: { id: true, countryCode: true, stateCode: true },
  });
  if (!branch) throw new Error("The selected branch is not available.");
  const [canonical, legacy] = await Promise.all([
    database.holidayOccurrence.findMany({
      where: {
        businessId: args.businessId,
        workDate: { gte: args.from, lte: args.to },
        status: "ACTIVE",
        OR: [
          { scope: "BUSINESS" },
          { scope: "BRANCH", branchId: branch.id },
          { scope: "NATIONAL", countryCode: branch.countryCode },
          ...(branch.stateCode ? [{ scope: "STATE" as const, countryCode: branch.countryCode, stateCode: branch.stateCode }] : []),
        ],
      },
      orderBy: [{ workDate: "asc" }, { statutory: "desc" }, { name: "asc" }],
    }),
    database.payrollHoliday.findMany({
      where: { businessId: args.businessId, branchId: branch.id, workDate: { gte: args.from, lte: args.to } },
      orderBy: { workDate: "asc" },
    }),
  ]);
  const result: ResolvedHoliday[] = canonical.filter((item) => holidayAppliesToBranch(item, branch)).map((item) => ({
    id: item.id,
    workDate: item.workDate,
    name: item.name,
    holidayType: item.holidayType,
    source: item.source,
    scope: item.scope,
    revision: item.revision,
    statutory: item.statutory,
    officialReference: item.officialReference,
    legacyPayrollHolidayId: null,
  }));
  const keys = new Set(result.map((item) => `${dateValue(item.workDate)}:${item.name.toLowerCase()}`));
  for (const item of legacy) {
    const key = `${dateValue(item.workDate)}:${item.name.toLowerCase()}`;
    if (keys.has(key)) continue;
    result.push({ id: item.id, workDate: item.workDate, name: item.name, holidayType: "PUBLIC_HOLIDAY", source: "LEGACY_PAYROLL", scope: "BRANCH", revision: 1, statutory: true, officialReference: null, legacyPayrollHolidayId: item.id });
  }
  return result.sort((left, right) => left.workDate.getTime() - right.workDate.getTime() || left.name.localeCompare(right.name));
}

export async function listHolidayCalendar(args: { businessId: string; year: number; database?: HolidayDatabase }) {
  const database = args.database ?? prisma;
  const from = new Date(Date.UTC(args.year, 0, 1));
  const to = new Date(Date.UTC(args.year, 11, 31));
  return database.holidayOccurrence.findMany({
    where: { businessId: args.businessId, workDate: { gte: from, lte: to } },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ workDate: "asc" }, { name: "asc" }, { revision: "desc" }],
  });
}

export async function previewOfficialHolidayCalendar(args: {
  businessId: string;
  countryCode: string;
  stateCode: string | null;
  year: number;
  database?: HolidayDatabase;
}) {
  const catalog = getOfficialHolidayCatalog(args);
  if (!catalog) return null;
  const database = args.database ?? prisma;
  const existing = await database.holidayOccurrence.findMany({
    where: {
      businessId: args.businessId,
      workDate: {
        gte: new Date(Date.UTC(args.year, 0, 1)),
        lte: new Date(Date.UTC(args.year, 11, 31)),
      },
    },
    select: { workDate: true, name: true },
  });
  const existingKeys = new Set(existing.map((item) => officialHolidayKey(item.workDate, item.name)));
  const entries = catalog.entries.map((entry) => ({
    ...entry,
    installed: existingKeys.has(officialHolidayKey(entry.workDate, entry.name)),
  }));
  return {
    ...catalog,
    entries,
    installedCount: entries.filter((entry) => entry.installed).length,
    missingCount: entries.filter((entry) => !entry.installed).length,
  };
}

export async function importOfficialHolidayCalendar(args: {
  businessId: string;
  allowedBranchIds: readonly string[];
  actor: HolidayActor;
  request?: AuditRequestContext;
  countryCode: string;
  stateCode: string | null;
  year: number;
  database?: HolidayDatabase;
}) {
  const catalog = getOfficialHolidayCatalog(args);
  if (!catalog) throw new Error("No verified official holiday calendar is available for this jurisdiction and year.");
  const database = args.database ?? prisma;
  const run = async (transaction: Prisma.TransactionClient) => {
    await transaction.$queryRaw<{ locked: boolean }[]>`
      SELECT true AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtext(${`official-holidays:${args.businessId}:${catalog.countryCode}:${catalog.stateCode}:${catalog.year}`}))) AS acquired
    `;
    const branch = await transaction.branch.findFirst({
      where: {
        businessId: args.businessId,
        id: { in: [...args.allowedBranchIds] },
        countryCode: catalog.countryCode,
        stateCode: catalog.stateCode,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!branch) throw new Error("No authorised active Sabah branch is available for this import.");

    const existing = await transaction.holidayOccurrence.findMany({
      where: {
        businessId: args.businessId,
        workDate: {
          gte: new Date(Date.UTC(catalog.year, 0, 1)),
          lte: new Date(Date.UTC(catalog.year, 11, 31)),
        },
      },
      select: { workDate: true, name: true },
    });
    const existingKeys = new Set(existing.map((item) => officialHolidayKey(item.workDate, item.name)));
    const missing = catalog.entries.filter((entry) => !existingKeys.has(officialHolidayKey(entry.workDate, entry.name)));
    const created = [];
    for (const entry of missing) {
      created.push(await transaction.holidayOccurrence.create({
        data: {
          businessId: args.businessId,
          branchId: null,
          workDate: new Date(`${entry.workDate}T00:00:00.000Z`),
          name: entry.name,
          holidayType: "PUBLIC_HOLIDAY",
          source: "OFFICIAL",
          scope: "STATE",
          countryCode: catalog.countryCode,
          stateCode: catalog.stateCode,
          statutory: true,
          officialReference: entry.officialReference,
          reason: `Imported from the verified ${catalog.jurisdictionLabel} ${catalog.year} official calendar.`,
          createdById: args.actor.userId,
        },
      }));
    }
    await writeAuditLog({
      businessId: args.businessId,
      branchId: null,
      actor: args.actor,
      request: args.request,
      action: "OFFICIAL_HOLIDAY_CALENDAR_IMPORTED",
      entityType: "Business",
      entityId: args.businessId,
      summary: `${created.length} missing ${catalog.jurisdictionLabel} official holiday occurrences imported for ${catalog.year}.`,
      after: { countryCode: catalog.countryCode, stateCode: catalog.stateCode, year: catalog.year, createdIds: created.map((item) => item.id) },
      metadata: { sourceUrl: catalog.sourceUrl, payrollEffect: "NONE", existingFactsChanged: false },
    }, transaction);
    return { createdCount: created.length, totalCount: catalog.entries.length };
  };
  if ("$transaction" in database) {
    return (database as PrismaClient).$transaction(run, { isolationLevel: "Serializable", timeout: 30_000 });
  }
  return run(database as Prisma.TransactionClient);
}

export async function createHolidayOccurrence(args: { businessId: string; allowedBranchIds: readonly string[]; actor: HolidayActor; request?: AuditRequestContext; input: unknown; database?: PrismaClient }) {
  const database = args.database ?? prisma;
  const input = holidayInputSchema.parse(args.input);
  assertBranchScope(input.scope, input.branchId, args.allowedBranchIds);
  return database.$transaction(async (transaction) => {
    const created = await transaction.holidayOccurrence.create({ data: { businessId: args.businessId, branchId: input.scope === "BRANCH" ? input.branchId : null, workDate: input.workDate, name: input.name, holidayType: input.holidayType, source: input.source, scope: input.scope, countryCode: input.countryCode, stateCode: input.scope === "STATE" ? input.stateCode : null, statutory: input.statutory, officialReference: input.officialReference || null, reason: input.reason || null, createdById: args.actor.userId } });
    await writeAuditLog({ businessId: args.businessId, branchId: created.branchId, actor: args.actor, request: args.request, action: "HOLIDAY_CREATED", entityType: "HolidayOccurrence", entityId: created.id, summary: "Holiday occurrence created without changing Roster, Attendance, Timesheet or Payroll facts.", after: created, metadata: { payrollEffect: "NONE" } }, transaction);
    return created;
  });
}

export async function reviseHolidayOccurrence(args: { businessId: string; allowedBranchIds: readonly string[]; actor: HolidayActor; request?: AuditRequestContext; holidayId: string; input: unknown; database?: PrismaClient }) {
  const database = args.database ?? prisma;
  const input = holidayInputSchema.parse(args.input);
  assertBranchScope(input.scope, input.branchId, args.allowedBranchIds);
  return database.$transaction(async (transaction) => {
    const current = await transaction.holidayOccurrence.findFirst({ where: { id: args.holidayId, businessId: args.businessId, status: "ACTIVE" } });
    if (!current) throw new Error("The active holiday record was not found.");
    if (current.branchId && !args.allowedBranchIds.includes(current.branchId)) throw new Error("You cannot manage this branch holiday.");
    await transaction.holidayOccurrence.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
    const created = await transaction.holidayOccurrence.create({ data: { businessId: args.businessId, branchId: input.scope === "BRANCH" ? input.branchId : null, workDate: input.workDate, name: input.name, holidayType: input.holidayType, source: input.source, scope: input.scope, countryCode: input.countryCode, stateCode: input.scope === "STATE" ? input.stateCode : null, statutory: input.statutory, officialReference: input.officialReference || null, reason: input.reason || null, revision: current.revision + 1, supersedesHolidayId: current.id, createdById: args.actor.userId } });
    await writeAuditLog({ businessId: args.businessId, branchId: created.branchId, actor: args.actor, request: args.request, action: "HOLIDAY_REVISED", entityType: "HolidayOccurrence", entityId: created.id, summary: "Holiday occurrence revised as a new immutable version.", before: current, after: created, metadata: { payrollEffect: "NONE", historicalTimesheetsChanged: false } }, transaction);
    return created;
  });
}

export async function cancelHolidayOccurrence(args: { businessId: string; allowedBranchIds: readonly string[]; actor: HolidayActor; request?: AuditRequestContext; holidayId: string; reason: string; database?: PrismaClient }) {
  const database = args.database ?? prisma;
  const reason = args.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Enter a cancellation reason.");
  return database.$transaction(async (transaction) => {
    const current = await transaction.holidayOccurrence.findFirst({ where: { id: args.holidayId, businessId: args.businessId, status: "ACTIVE" } });
    if (!current) throw new Error("The active holiday record was not found.");
    if (current.branchId && !args.allowedBranchIds.includes(current.branchId)) throw new Error("You cannot manage this branch holiday.");
    if (current.source === "OFFICIAL") throw new Error("Official holidays cannot be cancelled. Save an audited correction instead.");
    const cancelled = await transaction.holidayOccurrence.update({ where: { id: current.id }, data: { status: "CANCELLED", reason } });
    await writeAuditLog({ businessId: args.businessId, branchId: current.branchId, actor: args.actor, request: args.request, action: "HOLIDAY_CANCELLED", entityType: "HolidayOccurrence", entityId: current.id, summary: "Holiday occurrence cancelled; prior evidence remains immutable.", before: current, after: cancelled, metadata: { payrollEffect: "NONE", historicalTimesheetsChanged: false } }, transaction);
    return cancelled;
  });
}

export async function updateBranchHolidayJurisdiction(args: { businessId: string; allowedBranchIds: readonly string[]; actor: HolidayActor; request?: AuditRequestContext; branchId: string; countryCode: string; stateCode: string | null; database?: PrismaClient }) {
  const database = args.database ?? prisma;
  if (!args.allowedBranchIds.includes(args.branchId)) throw new Error("You cannot manage this branch.");
  const countryCode = args.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("Use a two-letter country code.");
  return database.$transaction(async (transaction) => {
    const current = await transaction.branch.findFirstOrThrow({ where: { id: args.branchId, businessId: args.businessId } });
    const updated = await transaction.branch.update({ where: { id: current.id }, data: { countryCode, stateCode: args.stateCode?.trim().toUpperCase() || null } });
    await writeAuditLog({ businessId: args.businessId, branchId: current.id, actor: args.actor, request: args.request, action: "BRANCH_HOLIDAY_JURISDICTION_UPDATED", entityType: "Branch", entityId: current.id, summary: "Branch holiday jurisdiction updated.", before: { countryCode: current.countryCode, stateCode: current.stateCode }, after: { countryCode: updated.countryCode, stateCode: updated.stateCode } }, transaction);
    return updated;
  });
}

function assertBranchScope(scope: string, branchId: string | null | undefined, allowedBranchIds: readonly string[]) {
  if (scope === "BRANCH" && (!branchId || !allowedBranchIds.includes(branchId))) throw new Error("Select an authorised branch.");
}

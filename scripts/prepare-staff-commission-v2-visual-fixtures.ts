import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient, type CommissionSourceType } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseHost = databaseUrl ? new URL(databaseUrl).hostname.toLowerCase() : "";
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  throw new Error("Commission V2 visual fixtures are restricted to a Local database.");
}

const root = process.cwd();
const sourcePath = join(root, ".tmp", "staff-pay-hub-v2-visual-fixtures.json");
const artifactPath = join(root, ".tmp", "staff-commission-v2-visual-fixtures.json");
const prisma = new PrismaClient();

async function main() {
  const preparation = spawnSync(process.execPath, ["--import", "tsx", "scripts/prepare-staff-pay-hub-v2-visual-fixtures.ts"], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  if (preparation.status !== 0) throw new Error(preparation.stderr || preparation.stdout || "Pay Hub fixture preparation failed.");
  const base = JSON.parse(await readFile(sourcePath, "utf8"));

  const normalContext = await context(base.normal.businessId, base.normal.membershipId);
  const juneStale = await createPeriod(normalContext, {
    end: "2026-06-30", revision: 1, start: "2026-06-01", status: "CALCULATED", total: 1000,
    lines: [{ date: "2026-06-12", eligible: 10_000, commission: 1000, type: "SERVICE" }],
  });
  await prisma.commissionPeriod.update({ where: { id: juneStale.periodId }, data: { currentRevision: 2 } });
  const juneCurrent = await createStatementForExistingPeriod(normalContext, {
    periodId: juneStale.periodId, revision: 2, status: "CALCULATED", total: 1250,
    lines: [{ date: "2026-06-12", eligible: 12_500, commission: 1250, type: "SERVICE" }],
  });
  const july = await createPeriod(normalContext, {
    end: "2026-07-31", revision: 1, start: "2026-07-01", status: "APPROVED", total: 3450,
    lines: [
      { date: "2026-07-08", eligible: 20_000, commission: 2000, type: "SERVICE" },
      { date: "2026-07-21", eligible: 14_500, commission: 1450, type: "PRODUCT" },
    ],
  });
  const august = await createPeriod(normalContext, {
    end: "2026-08-31", revision: 1, start: "2026-08-01", status: "APPLIED_TO_PAYROLL", total: 7000,
    lines: [
      { date: "2026-08-05", eligible: 20_000, commission: 2000, type: "SERVICE" },
      { date: "2026-08-16", eligible: 30_000, commission: 3000, type: "PRODUCT" },
      { date: "2026-08-27", eligible: 20_000, commission: 2000, type: "PACKAGE_PURCHASE" },
    ],
  });

  const zeroContext = await context(base.commissionOnly.businessId, base.commissionOnly.membershipId);
  const zeroLines = await createPeriod(zeroContext, {
    end: "2026-08-15", revision: 1, start: "2026-08-01", status: "CALCULATED", total: 0, lines: [],
  });

  const longContext = await context(base.longLarge.businessId, base.longLarge.membershipId);
  const positive = await createPeriod(longContext, {
    adjustment: { amount: 2345, reason: "Reviewed service leadership and customer care correction for the earning period.", type: "MANUAL_CORRECTION" },
    end: "2026-08-31", revision: 1, start: "2026-08-01", status: "APPROVED", total: 125_801,
    lines: [{ date: "2026-08-18", eligible: 1_234_560, commission: 123_456, type: "PACKAGE_REDEMPTION" }],
  });
  const negative = await createPeriod(longContext, {
    adjustment: { amount: -1000, reason: "A very long reviewed correction reason that must wrap safely without changing the viewport width on a compact phone.", type: "MANUAL_CORRECTION" },
    end: "2026-09-30", revision: 1, start: "2026-09-01", status: "APPLIED_TO_PAYROLL", total: 12_345_678,
    lines: [{ date: "2026-09-22", eligible: 12_346_678, commission: 12_346_678, type: "PACKAGE_PURCHASE" }],
  });

  const fixture = {
    environment: "LOCAL ONLY",
    productionAccessed: false,
    productionModified: false,
    noStatement: base.noPublication,
    calculated: { ...base.normal, periodId: juneCurrent.periodId },
    approved: { ...base.normal, periodId: july.periodId },
    appliedToPayroll: { ...base.normal, periodId: august.periodId },
    multiplePeriods: { ...base.normal, periodId: august.periodId },
    recalculatedCurrentRevision: { ...base.normal, periodId: juneCurrent.periodId, staleStatementId: juneStale.statementId, currentStatementId: juneCurrent.statementId },
    positiveAdjustment: { ...base.longLarge, periodId: positive.periodId },
    negativeAdjustment: { ...base.longLarge, periodId: negative.periodId },
    largeTotal: { ...base.longLarge, periodId: negative.periodId },
    longAdjustmentReason: { ...base.longLarge, periodId: negative.periodId },
    managerAsEmployee: { ...base.longLarge, periodId: positive.periodId },
    multiEmployerA: { ...base.normal, periodId: august.periodId },
    multiEmployerB: base.noPublication,
    zeroBreakdownLines: { ...base.commissionOnly, periodId: zeroLines.periodId },
  };
  await mkdir(join(root, ".tmp"), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stdout.write(JSON.stringify({ artifactPath, environment: fixture.environment, states: Object.keys(fixture).slice(3) }, null, 2));
}

async function context(businessId: string, membershipId: string) {
  const [branch, owner, membership] = await Promise.all([
    prisma.branch.findFirstOrThrow({ where: { businessId }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ where: { businessId, role: "BUSINESS_OWNER" }, select: { id: true } }),
    prisma.employeeBusinessMembership.findUniqueOrThrow({ where: { id: membershipId }, select: { id: true } }),
  ]);
  const approver = await prisma.user.create({
    data: { branchId: branch.id, businessId, name: `Commission fixture approver ${randomUUID()}`, role: "BUSINESS_OWNER" },
  });
  return { approverId: approver.id, businessId, branchId: branch.id, membershipId: membership.id, ownerId: owner.id };
}

type FixtureContext = Awaited<ReturnType<typeof context>>;
type Line = { date: string; eligible: number; commission: number; type: CommissionSourceType };
type FixtureInput = {
  adjustment?: { amount: number; reason: string; type: "REFUND" | "VOID" | "MANUAL_CORRECTION" };
  end: string;
  lines: Line[];
  revision: number;
  start: string;
  status: "CALCULATED" | "APPROVED" | "APPLIED_TO_PAYROLL";
  total: number;
};

async function createPeriod(ctx: FixtureContext, input: FixtureInput) {
  const period = await prisma.commissionPeriod.create({
    data: {
      approvedAt: input.status === "CALCULATED" ? null : new Date(`${input.end}T10:00:00.000Z`),
      approvedById: input.status === "CALCULATED" ? null : ctx.ownerId,
      businessId: ctx.businessId,
      currentRevision: input.revision,
      earnedPeriodEnd: date(input.end),
      earnedPeriodStart: date(input.start),
      scopeKey: `ALL-${randomUUID()}`,
      status: input.status === "CALCULATED" ? "CALCULATED" : "LOCKED",
    },
  });
  return createStatementForExistingPeriod(ctx, { ...input, periodId: period.id });
}

async function createStatementForExistingPeriod(ctx: FixtureContext, input: Omit<FixtureInput, "start" | "end"> & { periodId: string }) {
  const adjustmentCents = input.adjustment?.amount ?? 0;
  const calculatedCommissionCents = input.total - adjustmentCents;
  const period = await prisma.commissionPeriod.findUniqueOrThrow({
    where: { id: input.periodId },
    select: { earnedPeriodStart: true, earnedPeriodEnd: true },
  });
  const payrollVariablePay = input.status === "APPLIED_TO_PAYROLL" ? await prisma.payrollVariablePay.create({
    data: {
      amount: (input.total / 100).toFixed(2), approvedAt: new Date("2026-09-01T01:00:00.000Z"),
      approvedById: ctx.approverId, businessId: ctx.businessId, code: "COMMISSION", createdById: ctx.ownerId,
      earnedPeriodEnd: period.earnedPeriodEnd, earnedPeriodStart: period.earnedPeriodStart,
      membershipId: ctx.membershipId, name: "Commission", origin: "SYSTEM",
      payrollPeriodStart: new Date("2026-10-01T00:00:00.000Z"), reason: "Local Commission V2 visual fixture",
      sourceReference: `COMMISSION:${input.periodId}:${randomUUID()}`, status: "APPROVED", type: "COMMISSION",
    },
  }) : null;
  const statement = await prisma.commissionStatement.create({
    data: {
      adjustmentCents,
      approvedAt: input.status === "CALCULATED" ? null : new Date("2026-09-01T01:00:00.000Z"),
      approvedById: input.status === "CALCULATED" ? null : ctx.ownerId,
      businessId: ctx.businessId,
      calculatedCommissionCents,
      calculationDigest: digest(randomUUID()),
      calculationRevision: input.revision,
      eligibleSalesCents: input.lines.reduce((sum, line) => sum + line.eligible, 0),
      finalCommissionCents: input.total,
      membershipId: ctx.membershipId,
      payrollVariablePayId: payrollVariablePay?.id,
      periodId: input.periodId,
      status: input.status,
    },
  });

  let firstAccrualId: string | null = null;
  for (const [index, line] of input.lines.entries()) {
    const rule = await prisma.commissionRule.create({
      data: { businessId: ctx.businessId, createdById: ctx.ownerId, name: `Local ${line.type} ${randomUUID()}`, sourceType: line.type },
    });
    const revision = await prisma.commissionRuleRevision.create({
      data: {
        basis: "NET_AFTER_DISCOUNT", businessId: ctx.businessId, createdById: ctx.ownerId,
        effectiveFrom: date("2026-01-01"), priority: index, rateBasisPoints: 1000, reason: "Local visual fixture",
        revision: 1, ruleId: rule.id, ruleType: "PERCENTAGE", scope: "ALL",
      },
    });
    const service = await prisma.service.create({ data: { businessId: ctx.businessId, name: `Fixture source ${randomUUID()}`, price: line.eligible / 100 } });
    const invoice = await prisma.invoice.create({
      data: {
        balance: 0, branchId: ctx.branchId, businessId: ctx.businessId, invoiceNumber: `COMM-V2-${randomUUID()}`,
        issuedAt: new Date(`${line.date}T06:00:00.000Z`), paidAmount: line.eligible / 100, status: "PAID",
        subtotal: line.eligible / 100, total: line.eligible / 100,
        items: { create: { businessId: ctx.businessId, commissionMembershipId: ctx.membershipId, lineTotal: line.eligible / 100, name: service.name, quantity: 1, serviceId: service.id, unitPrice: line.eligible / 100 } },
      },
      include: { items: { select: { id: true } } },
    });
    const source = await prisma.commissionSourceEvent.create({
      data: {
        attributionStatus: "ATTRIBUTED", branchId: ctx.branchId, businessDate: date(line.date), businessId: ctx.businessId,
        discountAmountCents: 0, eventAt: new Date(`${line.date}T06:00:00.000Z`), grossAmountCents: line.eligible,
        invoiceId: invoice.id, invoiceItemId: invoice.items[0].id, membershipId: ctx.membershipId,
        netAmountCents: line.eligible, quantity: 1, sourceRevision: digest(randomUUID()), sourceType: line.type,
      },
    });
    const accrual = await prisma.commissionAccrual.create({
      data: {
        businessId: ctx.businessId, calculationRevision: input.revision,
        calculationTrace: { localFixture: true }, commissionAmountCents: line.commission, eligibleAmountCents: line.eligible,
        membershipId: ctx.membershipId, ruleRevisionId: revision.id, ruleSnapshot: { localFixture: true },
        sourceEventId: source.id, statementId: statement.id,
      },
    });
    firstAccrualId ??= accrual.id;
  }

  if (input.adjustment && firstAccrualId) {
    await prisma.commissionAdjustment.create({
      data: {
        accrualId: firstAccrualId, appliedToStatementId: statement.id, businessId: ctx.businessId,
        commissionAmountCents: input.adjustment.amount, createdById: ctx.ownerId, eligibleAmountCents: 0,
        membershipId: ctx.membershipId, payrollStatus: "APPLIED_TO_FUTURE_STATEMENT", reason: input.adjustment.reason,
        statementId: statement.id, type: input.adjustment.type,
      },
    });
  }
  return { periodId: input.periodId, statementId: statement.id };
}

function date(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

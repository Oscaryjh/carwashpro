import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getEmployeeCommissionStatements } from "../../src/lib/commission/read";
import { commissionCalculationDetails, commissionItemName } from "../../src/lib/staff-pwa/commission-v2";

test("commission names show the sale-time item and explicitly identify missing historic names", () => {
  assert.equal(commissionItemName(" Signature Haircut ", "SERVICE"), "Signature Haircut");
  assert.equal(commissionItemName("Haircut 5-Visit Package", "PACKAGE_PURCHASE"), "Haircut 5-Visit Package");
  assert.equal(commissionItemName("洗发水 / Shampoo", "PRODUCT"), "洗发水 / Shampoo");
  assert.equal(commissionItemName("[TEST August aggregate] Haircut", "SERVICE"), "[TEST August aggregate] Haircut");
  assert.equal(commissionItemName(null, "SERVICE"), "Service (name not recorded)");
  assert.equal(commissionItemName(undefined, "PRODUCT"), "Product (name not recorded)");
  assert.equal(commissionItemName("   ", "PACKAGE_PURCHASE"), "Package purchase (name not recorded)");
});

test("commission rates use frozen percentage, fixed and applied tier facts including zero", () => {
  assert.deepEqual(commissionCalculationDetails({ ruleType: "PERCENTAGE", appliedRateBasisPoints: 1000, basis: "NET_AFTER_DISCOUNT" }),
    { rateLabel: "10%", basisLabel: "Net after discount" });
  assert.equal(commissionCalculationDetails({ ruleType: "PERCENTAGE", appliedRateBasisPoints: 525 }).rateLabel, "5.25%");
  assert.equal(commissionCalculationDetails({ ruleType: "PERCENTAGE", appliedRateBasisPoints: 0 }).rateLabel, "0%");
  assert.equal(commissionCalculationDetails({ ruleType: "TIERED_PERCENTAGE", appliedRateBasisPoints: 1250 }).rateLabel, "12.5% (tiered)");
  assert.equal(commissionCalculationDetails({ ruleType: "FIXED_AMOUNT", fixedAmountCents: 500 }).rateLabel, "RM 5.00 per unit");
  assert.equal(commissionCalculationDetails({ ruleType: "FIXED_AMOUNT", fixedAmountCents: 0 }).rateLabel, "RM 0.00 per unit");
  assert.equal(commissionCalculationDetails({ basis: "GROSS" }).basisLabel, "Gross amount");
  assert.equal(commissionCalculationDetails({ basis: "NET_AFTER_DISCOUNT", basisOverride: "TRAINING_COMPLIMENTARY_GROSS" }).basisLabel,
    "Original gross amount (training / complimentary)");
});

test("missing or malformed calculation evidence cannot invent a rate or expose internal values", () => {
  for (const value of [null, undefined, [], "10%", {}, { ruleType: "NEW_RULE" },
    { ruleType: "PERCENTAGE", appliedRateBasisPoints: "1000" },
    { ruleType: "PERCENTAGE", appliedRateBasisPoints: -1 },
    { ruleType: "PERCENTAGE", appliedRateBasisPoints: 10001 },
    { ruleType: "PERCENTAGE", appliedRateBasisPoints: 1.5 },
    { ruleType: "PERCENTAGE", appliedRateBasisPoints: NaN },
    { ruleType: "PERCENTAGE", appliedRateBasisPoints: Infinity },
    { ruleType: "FIXED_AMOUNT", fixedAmountCents: -1 },
    { ruleType: "FIXED_AMOUNT", fixedAmountCents: 100_000_001 },
    { eligibleAmountCents: 10000, commissionAmountCents: 1000, sourceEventId: "private-id", candidateCount: 5 },
  ]) assert.deepEqual(commissionCalculationDetails(value), { rateLabel: "Not recorded", basisLabel: null });
});

test("employee reader batch-loads named sale lines with own/current scope and strips raw calculation traces", async () => {
  const businessId = "140616ab-9644-4a8b-8003-7da1f0968f7f";
  const membershipId = "1ec94903-3fbd-4470-8887-35c89615eb8a";
  let reads = 0;
  const rows = [
    { sourceType: "SERVICE", name: "Original haircut name", quantity: 2, commission: 45000 },
    { sourceType: "PACKAGE_PURCHASE", name: "5-Visit Package", quantity: 1, commission: 15000 },
    { sourceType: "PRODUCT", name: "Shampoo", quantity: 3, commission: 12000 },
  ];
  const database = {
    $queryRaw: async (query: { values: unknown[]; sql: string }) => {
      assert.deepEqual(query.values, [businessId, membershipId]);
      assert.match(query.sql, /statement\."calculation_revision" = period\."current_revision"/);
      return [{ id: "current-own-statement" }];
    },
    commissionStatement: { findMany: async (input: {
      where: unknown;
      include: { accruals: { select: { sourceEvent: { select: Record<string, unknown> } } } };
    }) => {
      reads++;
      assert.deepEqual(input.where, { id: { in: ["current-own-statement"] }, businessId, membershipId,
        status: { in: ["CALCULATED", "APPROVED", "APPLIED_TO_PAYROLL"] } });
      const selected = input.include.accruals.select.sourceEvent.select;
      assert.deepEqual(selected.invoiceItem, { select: { name: true } });
      assert.deepEqual(selected.invoice, { select: { invoiceNumber: true } });
      assert.equal(selected.quantity, true);
      assert.equal("customer" in selected, false);
      return [{ id: "current-own-statement", finalCommissionCents: 72000,
        accruals: rows.map(row => ({ status: "ACTIVE", eligibleAmountCents: row.commission * 10,
          commissionAmountCents: row.commission,
          calculationTrace: { ruleType: "PERCENTAGE", appliedRateBasisPoints: 1000, basis: "NET_AFTER_DISCOUNT",
            selectedRuleRevisionId: "private-rule-id", eligibleRuleRevisionIds: ["private-rule-id"] },
          sourceEvent: { sourceType: row.sourceType, quantity: row.quantity, invoiceItem: { name: row.name },
            invoice: { invoiceNumber: `TEST-${row.sourceType}` } },
        })),
      }];
    } },
  } as unknown as PrismaClient;
  const statements = await getEmployeeCommissionStatements({ businessId, membershipId }, database);
  assert.equal(reads, 1);
  assert.equal(statements[0].finalCommissionCents, 72000);
  for (const [index, line] of statements[0].accruals.entries()) {
    assert.equal(line.sourceEvent.invoiceItem.name, rows[index].name);
    assert.equal(line.sourceEvent.quantity, rows[index].quantity);
    assert.equal(line.sourceEvent.invoice.invoiceNumber, `TEST-${rows[index].sourceType}`);
    assert.equal(line.commissionAmountCents, rows[index].commission);
    assert.deepEqual(line.calculation, { rateLabel: "10%", basisLabel: "Net after discount" });
    assert.equal("calculationTrace" in line, false);
    assert.equal(JSON.stringify(line).includes("private-rule-id"), false);
  }
});

test("no current own statement means no invoice or accrual lookup", async () => {
  const database = { $queryRaw: async () => [], commissionStatement: { findMany: async () => { throw new Error("Unexpected read"); } } } as unknown as PrismaClient;
  assert.deepEqual(await getEmployeeCommissionStatements({ businessId: "business", membershipId: "member" }, database), []);
});

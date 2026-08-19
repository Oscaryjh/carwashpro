import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import {
  registerSabahWorkPayCandidate,
  resolveActiveSabahWorkPayRule,
  STATUTORY_MONEY_RULE_NOT_READY,
} from "../../src/lib/payroll/sabah-work-pay-service";
import {
  SABAH_WORK_PAY_CALCULATOR_TEST_DIGEST,
  SABAH_WORK_PAY_DATASET_DIGEST,
  SABAH_WORK_PAY_DATASET_ROW_COUNT,
  SABAH_WORK_PAY_RULE_VERSION,
  SABAH_WORK_PAY_SOURCE_DIGEST,
} from "../../src/lib/payroll/sabah-work-pay-rule-pack";

const rollbackMessage = "PAYROLL_P6C_ROLLBACK";

test("P6C registers an audited candidate but never resolves it as active", async () => {
  assertLocalDatabase();

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const database = transactionDatabase(transaction);
      const actorUserId = randomUUID();
      const registration = await registerSabahWorkPayCandidate(
        {
          actorUserId,
          reason: "P6C integration verification in a rollback-only local transaction.",
        },
        database,
      );

      assert.equal(registration.status, "REGISTERED");
      const candidate = await transaction.statutoryRuleSet.findUniqueOrThrow({
        where: {
          scheme_version: {
            scheme: "WORK_PAY",
            version: SABAH_WORK_PAY_RULE_VERSION,
          },
        },
      });
      assert.equal(candidate.status, "READY_FOR_HUMAN_SIGN_OFF");
      assert.equal(candidate.humanReviewStatus, "PENDING");
      assert.equal(candidate.sourceDigest, SABAH_WORK_PAY_SOURCE_DIGEST);
      assert.equal(candidate.datasetDigest, SABAH_WORK_PAY_DATASET_DIGEST);
      assert.equal(candidate.calculatorTestDigest, SABAH_WORK_PAY_CALCULATOR_TEST_DIGEST);
      assert.equal(candidate.datasetRowCount, SABAH_WORK_PAY_DATASET_ROW_COUNT);
      assert.equal(candidate.activatedAt, null);

      const audits = await transaction.statutoryRuleLifecycleAudit.findMany({
        where: { ruleSetId: candidate.id },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        audits.map((audit) => audit.action).sort(),
        ["CALCULATION_VERIFIED", "READY_FOR_REVIEW", "RULESET_REGISTERED"].sort(),
      );
      assert.ok(audits.every((audit) => audit.actorId === actorUserId));

      await assert.rejects(
        resolveActiveSabahWorkPayRule(new Date("2026-08-01T00:00:00.000Z"), database),
        (error: unknown) =>
          error instanceof Error && error.message === STATUTORY_MONEY_RULE_NOT_READY,
      );

      throw new Error(rollbackMessage);
    }),
    (error: unknown) => error instanceof Error && error.message === rollbackMessage,
  );
});

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return transaction as unknown as PrismaClient;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Payroll P6C integration tests are restricted to the local database.");
  }
}

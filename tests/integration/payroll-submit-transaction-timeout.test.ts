import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { submitPayrollRunForReview } from "../../src/lib/payroll/service";
import {
  confirmFixturePcb,
  createCanonicalPcbFixture,
} from "../helpers/manual-pcb-fixture";

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("five-second submit timeout rolls back review state and a safe retry creates each artifact once", async () => {
  const fixture = await createCanonicalPcbFixture();
  await confirmFixturePcb({
    businessId: fixture.business.id,
    entryId: fixture.entry.id,
    actorId: fixture.owner.id,
    amount: "0.00",
    externalReference: "CONTROLLED_LATENCY_ATOMICITY_EVIDENCE",
  });

  const delayed = new PrismaClient().$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          await sleep(350);
          return query(args);
        },
      },
    },
  });

  try {
    await assert.rejects(
      submitPayrollRunForReview(
        {
          businessId: fixture.business.id,
          runId: fixture.run.id,
          actor: fixture.actor,
        },
        delayed as unknown as PrismaClient,
      ),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "P2028");
        assert.match(candidate.message ?? "", /expired|already closed|timeout/i);
        return true;
      },
    );

    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({
        where: { id: fixture.run.id },
      })).status,
      "DRAFT",
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          businessId: fixture.business.id,
          entityId: fixture.run.id,
          action: "PAYROLL_RUN_SUBMITTED_FOR_REVIEW",
        },
      }),
      0,
    );
    assert.equal(
      await prisma.payrollPayslipPublication.count({
        where: { payrollEntryId: fixture.entry.id },
      }),
      0,
    );
    assert.equal(
      await prisma.payrollPaymentInstruction.count({
        where: { businessId: fixture.business.id },
      }),
      0,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "RC_STAGING_SYNTHETIC_INSTALLED" },
      }),
      0,
    );

    await submitPayrollRunForReview({
      businessId: fixture.business.id,
      runId: fixture.run.id,
      actor: fixture.actor,
    });
    const stableCounts = {
      runs: await prisma.payrollRun.count({
        where: { businessId: fixture.business.id },
      }),
      entries: await prisma.payrollEntry.count({
        where: { businessId: fixture.business.id },
      }),
      publications: await prisma.payrollPayslipPublication.count({
        where: { businessId: fixture.business.id },
      }),
      submitAudits: await prisma.auditLog.count({
        where: {
          businessId: fixture.business.id,
          entityId: fixture.run.id,
          action: "PAYROLL_RUN_SUBMITTED_FOR_REVIEW",
        },
      }),
    };
    assert.deepEqual(stableCounts, {
      runs: 1,
      entries: 1,
      publications: 0,
      submitAudits: 1,
    });

    await assert.rejects(
      submitPayrollRunForReview({
        businessId: fixture.business.id,
        runId: fixture.run.id,
        actor: fixture.actor,
      }),
    );
    assert.deepEqual(
      {
        runs: await prisma.payrollRun.count({
          where: { businessId: fixture.business.id },
        }),
        entries: await prisma.payrollEntry.count({
          where: { businessId: fixture.business.id },
        }),
        publications: await prisma.payrollPayslipPublication.count({
          where: { businessId: fixture.business.id },
        }),
        submitAudits: await prisma.auditLog.count({
          where: {
            businessId: fixture.business.id,
            entityId: fixture.run.id,
            action: "PAYROLL_RUN_SUBMITTED_FOR_REVIEW",
          },
        }),
      },
      stableCounts,
    );
  } finally {
    await delayed.$disconnect();
    await prisma.$disconnect();
  }
});

test("the guarded fixture client alone tolerates measured public-proxy latency", async () => {
  const fixture = await createCanonicalPcbFixture();
  await confirmFixturePcb({
    businessId: fixture.business.id,
    entryId: fixture.entry.id,
    actorId: fixture.owner.id,
    amount: "0.00",
    externalReference: "FIXTURE_ONLY_TRANSACTION_BUDGET_EVIDENCE",
  });
  const { createStagingFixtureDatabase } = await import(
    "../../scripts/lib/rc-staging-fixture-database"
  );
  let delayedOperations = 0;
  const fixtureDatabase = createStagingFixtureDatabase().$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          delayedOperations++;
          await sleep(350);
          return query(args);
        },
      },
    },
  });
  try {
    const startedAt = performance.now();
    await submitPayrollRunForReview(
      {
        businessId: fixture.business.id,
        runId: fixture.run.id,
        actor: fixture.actor,
      },
      fixtureDatabase as unknown as PrismaClient,
    );
    assert.ok(delayedOperations >= 10);
    assert.ok(performance.now() - startedAt >= 3_500);
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({
        where: { id: fixture.run.id },
      })).status,
      "REVIEW",
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          businessId: fixture.business.id,
          entityId: fixture.run.id,
          action: "PAYROLL_RUN_SUBMITTED_FOR_REVIEW",
        },
      }),
      1,
    );
  } finally {
    await fixtureDatabase.$disconnect();
    await prisma.$disconnect();
  }
});

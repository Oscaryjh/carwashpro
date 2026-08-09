import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import {
  FinancialOperationType,
  PrismaClient,
} from "@prisma/client";
import {
  FinancialIdempotencyConflictError,
  runFinancialOperation,
} from "../../src/lib/financial-idempotency";
import { enqueue } from "../../src/lib/notification-queue/repository";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("POS financial operations replay once, reject payload conflicts, isolate tenants, and survive rollback", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("A");
  const other = await createFixture("B");
  const sharedKey = `checkout:${randomUUID()}`;
  const checkout = () => runFinancialOperation({
    actorUserId: fixture.user.id,
    branchId: fixture.branch.id,
    businessId: fixture.business.id,
    operationKey: sharedKey,
    operationType: FinancialOperationType.CASHIER_CHECKOUT,
    payload: { amountCents: 10_000, lines: [{ id: "service-a", quantity: 1 }] },
    execute: async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          balance: 0,
          branchId: fixture.branch.id,
          businessId: fixture.business.id,
          invoiceNumber: `IDEMP-${fixture.suffix}`,
          paidAmount: 100,
          status: "PAID",
          subtotal: 100,
          total: 100,
        },
      });
      return { invoiceId: invoice.id, status: invoice.status };
    },
  });

  const [first, second] = await Promise.all([checkout(), checkout()]);
  assert.equal(first.result.invoiceId, second.result.invoiceId);
  assert.equal(Number(first.replayed) + Number(second.replayed), 1);
  assert.equal(
    await prisma.invoice.count({
      where: { businessId: fixture.business.id, invoiceNumber: `IDEMP-${fixture.suffix}` },
    }),
    1,
  );

  await assert.rejects(
    runFinancialOperation({
      actorUserId: fixture.user.id,
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      operationKey: sharedKey,
      operationType: FinancialOperationType.CASHIER_CHECKOUT,
      payload: { amountCents: 15_000 },
      execute: async () => ({ invoiceId: "must-not-run" }),
    }),
    (error: unknown) => error instanceof FinancialIdempotencyConflictError,
  );

  const crossTenant = await runFinancialOperation({
    actorUserId: other.user.id,
    branchId: other.branch.id,
    businessId: other.business.id,
    operationKey: sharedKey,
    operationType: FinancialOperationType.CASHIER_CHECKOUT,
    payload: { amountCents: 10_000, lines: [{ id: "service-a", quantity: 1 }] },
    execute: async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          balance: 0,
          branchId: other.branch.id,
          businessId: other.business.id,
          invoiceNumber: `IDEMP-${other.suffix}`,
          paidAmount: 100,
          status: "PAID",
          subtotal: 100,
          total: 100,
        },
      });
      return { invoiceId: invoice.id };
    },
  });
  assert.notEqual(crossTenant.result.invoiceId, first.result.invoiceId);

  const completedOperation = await prisma.financialOperation.findUniqueOrThrow({
    where: {
      businessId_operationType_operationKey: {
        businessId: fixture.business.id,
        operationKey: sharedKey,
        operationType: FinancialOperationType.CASHIER_CHECKOUT,
      },
    },
  });
  await assert.rejects(
    prisma.financialOperation.update({
      where: { id: completedOperation.id },
      data: { resultJson: { invoiceId: "tampered" } },
    }),
    /Completed financial operation is immutable/,
  );
  await assert.rejects(
    runFinancialOperation({
      actorUserId: fixture.user.id,
      branchId: other.branch.id,
      businessId: fixture.business.id,
      operationKey: `checkout:${randomUUID()}`,
      operationType: FinancialOperationType.CASHIER_CHECKOUT,
      payload: { amountCents: 100 },
      execute: async () => ({ invoiceId: "must-not-run" }),
    }),
    /Financial operation branch scope mismatch/,
  );

  const notificationDedupeKey = `INVOICE_SENT:${fixture.business.id}:${first.result.invoiceId}`;
  const queued = await enqueue({
    branchId: fixture.branch.id,
    businessId: fixture.business.id,
    dedupeKey: notificationDedupeKey,
    message: "Invoice ready",
    messageType: "INVOICE_SENT",
    phone: "+60123456789",
  });
  const queuedReplay = await enqueue({
    branchId: fixture.branch.id,
    businessId: fixture.business.id,
    dedupeKey: notificationDedupeKey,
    message: "Invoice ready",
    messageType: "INVOICE_SENT",
    phone: "+60123456789",
  });
  assert.equal(queued.id, queuedReplay.id);
  assert.equal(
    await prisma.notificationQueue.count({ where: { dedupeKey: notificationDedupeKey } }),
    1,
  );

  const rollbackKey = `payment:${randomUUID()}`;
  const rollbackReference = `rollback-${fixture.suffix}`;
  await assert.rejects(
    runFinancialOperation({
      actorUserId: fixture.user.id,
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      operationKey: rollbackKey,
      operationType: FinancialOperationType.WORK_ORDER_PAYMENT,
      payload: { amountCents: 100 },
      execute: async (tx) => {
        await tx.payment.create({
          data: {
            amount: 1,
            branchId: fixture.branch.id,
            businessId: fixture.business.id,
            method: "CASH",
            reference: rollbackReference,
          },
        });
        throw new Error("simulated failure before commit");
      },
    }),
    /simulated failure before commit/,
  );
  assert.equal(await prisma.payment.count({ where: { reference: rollbackReference } }), 0);
  assert.equal(
    await prisma.financialOperation.count({
      where: {
        businessId: fixture.business.id,
        operationKey: rollbackKey,
        operationType: FinancialOperationType.WORK_ORDER_PAYMENT,
      },
    }),
    0,
  );

  const retry = await runFinancialOperation({
    actorUserId: fixture.user.id,
    branchId: fixture.branch.id,
    businessId: fixture.business.id,
    operationKey: rollbackKey,
    operationType: FinancialOperationType.WORK_ORDER_PAYMENT,
    payload: { amountCents: 100 },
    execute: async (tx) => {
      const payment = await tx.payment.create({
        data: {
          amount: 1,
          branchId: fixture.branch.id,
          businessId: fixture.business.id,
          method: "CASH",
          reference: rollbackReference,
        },
      });
      return { paymentId: payment.id };
    },
  });
  assert.equal(retry.replayed, false);
  assert.equal(await prisma.payment.count({ where: { reference: rollbackReference } }), 1);
});

test("concurrent full payments cannot overpay and distinct partial operations remain valid", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("PAY");
  const workOrder = await createWorkOrder(fixture, 100);

  const pay = (operationKey: string, amountCents: number) =>
    runFinancialOperation({
      actorUserId: fixture.user.id,
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      operationKey,
      operationType: FinancialOperationType.WORK_ORDER_PAYMENT,
      payload: { amountCents, workOrderId: workOrder.id },
      execute: async (tx) => {
        const current = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } });
        const paidCents = Math.round(Number(current.paidAmount) * 100);
        const totalCents = Math.round(Number(current.total) * 100);
        if (amountCents > totalCents - paidCents) {
          throw new Error("Payment amount cannot exceed the outstanding balance.");
        }
        const payment = await tx.payment.create({
          data: {
            amount: amountCents / 100,
            branchId: fixture.branch.id,
            businessId: fixture.business.id,
            method: "CASH",
            workOrderId: workOrder.id,
          },
        });
        const nextPaidCents = paidCents + amountCents;
        await tx.workOrder.update({
          where: { id: workOrder.id },
          data: {
            balance: (totalCents - nextPaidCents) / 100,
            paidAmount: nextPaidCents / 100,
            paymentStatus: nextPaidCents === totalCents ? "PAID" : "PARTIAL",
          },
        });
        return { paymentId: payment.id };
      },
    });

  const concurrent = await Promise.allSettled([
    pay(`payment:${randomUUID()}`, 10_000),
    pay(`payment:${randomUUID()}`, 10_000),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const paid = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } });
  assert.equal(Number(paid.paidAmount), 100);
  assert.equal(Number(paid.balance), 0);
  assert.equal(
    await prisma.payment.count({ where: { workOrderId: workOrder.id, status: "ACTIVE" } }),
    1,
  );

  const partialOrder = await createWorkOrder(fixture, 100);
  const partialPay = async (operationKey: string, amountCents: number) => {
    const current = await prisma.workOrder.findUniqueOrThrow({ where: { id: partialOrder.id } });
    return runFinancialOperation({
      actorUserId: fixture.user.id,
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      operationKey,
      operationType: FinancialOperationType.WORK_ORDER_PAYMENT,
      payload: { amountCents, workOrderId: partialOrder.id },
      execute: async (tx) => {
        const payment = await tx.payment.create({
          data: {
            amount: amountCents / 100,
            branchId: fixture.branch.id,
            businessId: fixture.business.id,
            method: "CASH",
            workOrderId: partialOrder.id,
          },
        });
        await tx.workOrder.update({
          where: { id: partialOrder.id },
          data: {
            balance: Number(current.balance) - amountCents / 100,
            paidAmount: Number(current.paidAmount) + amountCents / 100,
            paymentStatus: amountCents === 6_000 ? "PAID" : "PARTIAL",
          },
        });
        return { paymentId: payment.id };
      },
    });
  };
  const firstPartialKey = `payment:${randomUUID()}`;
  const firstPartial = await partialPay(firstPartialKey, 4_000);
  const firstPartialReplay = await partialPay(firstPartialKey, 4_000);
  const secondPartial = await partialPay(`payment:${randomUUID()}`, 6_000);
  assert.equal(firstPartial.result.paymentId, firstPartialReplay.result.paymentId);
  assert.equal(firstPartialReplay.replayed, true);
  assert.notEqual(firstPartial.result.paymentId, secondPartial.result.paymentId);
  assert.equal(
    await prisma.payment.count({ where: { workOrderId: partialOrder.id, status: "ACTIVE" } }),
    2,
  );
});

test("package redemption retries decrement once and last-use concurrency permits one winner", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("PKG");
  const packagePlan = await prisma.package.create({
    data: {
      businessId: fixture.business.id,
      name: `Package ${fixture.suffix}`,
      price: 30,
      totalUses: 3,
    },
  });
  const reusable = await prisma.customerPackage.create({
    data: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      customerId: fixture.customer.id,
      packageId: packagePlan.id,
      purchasePrice: 30,
      remainingUses: 3,
      status: "ACTIVE",
      totalUses: 3,
    },
  });
  const redeem = (customerPackageId: string, operationKey: string) =>
    runFinancialOperation({
      actorUserId: fixture.user.id,
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      operationKey,
      operationType: FinancialOperationType.PACKAGE_REDEMPTION,
      payload: { customerPackageId, uses: 1 },
      execute: async (tx) => {
        const updated = await tx.customerPackage.updateMany({
          where: {
            businessId: fixture.business.id,
            id: customerPackageId,
            remainingUses: { gt: 0 },
            status: "ACTIVE",
          },
          data: { remainingUses: { decrement: 1 } },
        });
        if (updated.count !== 1) throw new Error("This customer package is no longer available.");
        const payment = await tx.payment.create({
          data: {
            amount: 10,
            branchId: fixture.branch.id,
            businessId: fixture.business.id,
            customerPackageId,
            method: "PACKAGE",
            packageUses: 1,
          },
        });
        return { paymentId: payment.id };
      },
    });

  const retryKey = `package-redemption:${randomUUID()}`;
  const initial = await redeem(reusable.id, retryKey);
  const replay = await redeem(reusable.id, retryKey);
  assert.equal(initial.result.paymentId, replay.result.paymentId);
  assert.equal(replay.replayed, true);
  assert.equal(
    (await prisma.customerPackage.findUniqueOrThrow({ where: { id: reusable.id } })).remainingUses,
    2,
  );

  const lastUse = await prisma.customerPackage.create({
    data: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      customerId: fixture.customer.id,
      packageId: packagePlan.id,
      purchasePrice: 30,
      remainingUses: 1,
      status: "ACTIVE",
      totalUses: 3,
    },
  });
  const concurrent = await Promise.allSettled([
    redeem(lastUse.id, `package-redemption:${randomUUID()}`),
    redeem(lastUse.id, `package-redemption:${randomUUID()}`),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    (await prisma.customerPackage.findUniqueOrThrow({ where: { id: lastUse.id } })).remainingUses,
    0,
  );
  assert.equal(
    await prisma.payment.count({ where: { customerPackageId: lastUse.id, packageUses: 1 } }),
    1,
  );
});

test("bounded stress run keeps 20 multi-branch checkout retries at 20 effects", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("STRESS");
  const secondBranch = await prisma.branch.create({
    data: { businessId: fixture.business.id, name: `Branch 2 ${fixture.suffix}` },
  });
  const operations = Array.from({ length: 20 }, (_, index) => ({
    branchId: index % 2 === 0 ? fixture.branch.id : secondBranch.id,
    index,
    key: `checkout:${randomUUID()}`,
  }));
  const invoke = (operation: (typeof operations)[number]) => runFinancialOperation({
    actorUserId: fixture.user.id,
    branchId: operation.branchId,
    businessId: fixture.business.id,
    operationKey: operation.key,
    operationType: FinancialOperationType.CASHIER_CHECKOUT,
    payload: { amountCents: 1_000 + operation.index, branchId: operation.branchId },
    execute: async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          balance: 0,
          branchId: operation.branchId,
          businessId: fixture.business.id,
          invoiceNumber: `STRESS-${fixture.suffix}-${operation.index}`,
          paidAmount: (1_000 + operation.index) / 100,
          status: "PAID",
          subtotal: (1_000 + operation.index) / 100,
          total: (1_000 + operation.index) / 100,
        },
      });
      return { invoiceId: invoice.id };
    },
  });

  const results: Awaited<ReturnType<typeof invoke>>[] = [];
  for (let offset = 0; offset < operations.length; offset += 5) {
    const batch = operations.slice(offset, offset + 5);
    results.push(...await Promise.all(
      batch.flatMap((operation) => [invoke(operation), invoke(operation)]),
    ));
  }
  assert.equal(new Set(results.map((entry) => entry.result.invoiceId)).size, 20);
  assert.equal(results.filter((entry) => entry.replayed).length, 20);
  assert.equal(
    await prisma.invoice.count({
      where: { businessId: fixture.business.id, invoiceNumber: { startsWith: `STRESS-${fixture.suffix}-` } },
    }),
    20,
  );
});

async function createFixture(label: string) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const business = await prisma.business.create({
    data: { name: `Idempotency ${suffix}`, slug: `idempotency-${suffix.toLowerCase()}` },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `Branch ${suffix}` },
  });
  const user = await prisma.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      name: `Owner ${suffix}`,
      role: "BUSINESS_OWNER",
    },
  });
  const customer = await prisma.customer.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      name: `Customer ${suffix}`,
      phone: `+60${Date.now()}${Math.floor(Math.random() * 1000)}`,
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      customerId: customer.id,
      plateNumber: `IDM${suffix.replaceAll("-", "").slice(-8).toUpperCase()}`,
    },
  });
  return { branch, business, customer, suffix, user, vehicle };
}

async function createWorkOrder(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  total: number,
) {
  return prisma.workOrder.create({
    data: {
      balance: total,
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      customerId: fixture.customer.id,
      orderNumber: `WO-${fixture.suffix}-${randomUUID().slice(0, 6)}`,
      paidAmount: 0,
      subtotal: total,
      total,
      vehicleId: fixture.vehicle.id,
    },
  });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for POS integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname),
    "POS integration tests must use a local database.",
  );
}

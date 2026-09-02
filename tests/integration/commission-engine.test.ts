import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  approveCommissionPeriod,
  calculateCommissionPeriod,
  captureCommissionRefundAdjustments,
  captureCommissionSourceEvents,
  captureCommissionVoidAdjustments,
  createCommissionRule,
  createManualCommissionCorrection,
  linkApprovedCommissionToPayroll,
  type CommissionWriteContext,
} from "../../src/lib/commission/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("commission lifecycle is tenant-scoped, immutable, approved-only and Payroll-idempotent", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `Commission ${token}`, slug: `commission-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `Branch ${token}` } });
  const calculator = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Commission Calculator", role: "BUSINESS_OWNER" } });
  const approver = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Commission Approver", role: "BUSINESS_OWNER" } });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await prisma.employeeAccount.create({ data: { name: "Commission Staff", phoneNumber: phone, phoneNormalized: phone } });
  const membership = await prisma.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: `COM-${token}`, fullName: "Commission Staff", phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2026-01-01T00:00:00.000Z") } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: `Service ${token}`, price: 100 } });
  const invoice = await prisma.invoice.create({ data: { businessId: business.id, branchId: branch.id, invoiceNumber: `COM-${token}`, subtotal: 100, discountAmount: 10, total: 90, paidAmount: 90, balance: 0, status: "PAID", issuedAt: new Date("2026-08-10T05:00:00.000Z"), items: { create: { businessId: business.id, serviceId: service.id, commissionMembershipId: membership.id, name: service.name, quantity: 1, unitPrice: 100, lineTotal: 100 } } } });
  const calculatorContext = context(business.id, calculator.id, ["MANAGE_COMMISSION_RULES", "CALCULATE_COMMISSION"]);
  const approverContext = context(business.id, approver.id, ["APPROVE_COMMISSION", "ADJUST_COMMISSION", "LINK_COMMISSION_TO_PAYROLL"]);

  await createCommissionRule(calculatorContext, { name: "Service 10%", sourceType: "SERVICE", scope: "ALL", ruleType: "PERCENTAGE", basis: "NET_AFTER_DISCOUNT", rateBasisPoints: 1_000, effectiveFrom: "2026-01-01", reason: "Initial QA commission rule." }, prisma);
  await assert.rejects(createCommissionRule(calculatorContext, {
    name: "Conflicting service default",
    sourceType: "SERVICE",
    scope: "ALL",
    ruleType: "PERCENTAGE",
    basis: "NET_AFTER_DISCOUNT",
    rateBasisPoints: 1_500,
    effectiveFrom: "2026-08-01",
    reason: "Parallel overlapping rules must be rejected.",
  }, prisma), /already covers this same employee or item/i);
  const concurrentCapture = await Promise.allSettled([
    captureCommissionSourceEvents(calculatorContext, {}, prisma),
    captureCommissionSourceEvents(calculatorContext, {}, prisma),
  ]);
  const successfulCaptures = concurrentCapture.filter(
    (result): result is PromiseFulfilledResult<{ invoiceCount: number; insertedEventCount: number }> => result.status === "fulfilled",
  );
  assert.ok(successfulCaptures.length >= 1);
  assert.equal(successfulCaptures.reduce((sum, result) => sum + result.value.insertedEventCount, 0), 1);
  const replayCapture = await captureCommissionSourceEvents(calculatorContext, {}, prisma);
  assert.equal(replayCapture.insertedEventCount, 0);
  assert.equal(await prisma.commissionSourceEvent.count({ where: { businessId: business.id } }), 1);

  const period = await calculateCommissionPeriod(calculatorContext, { earnedPeriodStart: "2026-08-01", earnedPeriodEnd: "2026-08-31" }, prisma);
  const statement = await prisma.commissionStatement.findFirstOrThrow({ where: { periodId: period.id, calculationRevision: period.currentRevision } });
  assert.equal(statement.eligibleSalesCents, 9_000);
  assert.equal(statement.finalCommissionCents, 900);
  await assert.rejects(calculateCommissionPeriod(calculatorContext, {
    earnedPeriodStart: "2026-08-15",
    earnedPeriodEnd: "2026-09-15",
  }, prisma), /overlaps an existing commission period/i);
  await assert.rejects(linkApprovedCommissionToPayroll(approverContext, { statementId: statement.id, targetPayrollMonth: "2026-09" }, prisma), /Only an approved statement/);

  await assert.rejects(approveCommissionPeriod(calculatorContext as CommissionWriteContext, { periodId: period.id, expectedRevision: period.currentRevision, reason: "Self approval attempt." }, prisma), /requires APPROVE_COMMISSION/);
  const approvedPeriod = await approveCommissionPeriod(approverContext, { periodId: period.id, expectedRevision: period.currentRevision, reason: "Independent calculation evidence reviewed." }, prisma);
  const approvalReplay = await approveCommissionPeriod(approverContext, { periodId: period.id, expectedRevision: period.currentRevision, reason: "Idempotent approval replay." }, prisma);
  assert.equal(approvalReplay.id, approvedPeriod.id);
  assert.equal(approvalReplay.status, "LOCKED");
  await assert.rejects(prisma.commissionAccrual.updateMany({ where: { statementId: statement.id }, data: { commissionAmountCents: 99_999 } }), /COMMISSION_APPEND_ONLY_RECORD_IMMUTABLE/);
  await assert.rejects(prisma.invoiceItem.updateMany({ where: { invoiceId: invoice.id }, data: { commissionMembershipId: null } }), /PAID_INVOICE_COMMISSION_ATTRIBUTION_IMMUTABLE/);

  const payroll = await linkApprovedCommissionToPayroll(approverContext, { statementId: statement.id, targetPayrollMonth: "2026-09" }, prisma);
  const replay = await linkApprovedCommissionToPayroll(approverContext, { statementId: statement.id, targetPayrollMonth: "2026-09" }, prisma);
  assert.equal(replay.id, payroll.id);
  assert.equal(payroll.status, "APPROVED");
  assert.equal(payroll.origin, "SYSTEM");
  assert.equal(Number(payroll.amount), 9);
  assert.equal(await prisma.payrollVariablePay.count({ where: { sourceReference: payroll.sourceReference } }), 1);

  const trainingInvoice = await prisma.invoice.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      invoiceNumber: `COM-TRAINING-${token}`,
      checkoutType: "TRAINING_COMPLIMENTARY",
      checkoutReason: "Supervised therapist training acceptance.",
      subtotal: 100,
      discountAmount: 100,
      discountReason: "Training / Complimentary: Supervised therapist training acceptance.",
      total: 0,
      paidAmount: 0,
      balance: 0,
      status: "PAID",
      issuedAt: new Date("2026-06-10T05:00:00.000Z"),
      items: {
        create: {
          businessId: business.id,
          serviceId: service.id,
          commissionMembershipId: membership.id,
          name: service.name,
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
      },
    },
  });
  const trainingPeriod = await calculateCommissionPeriod(calculatorContext, {
    earnedPeriodStart: "2026-06-01",
    earnedPeriodEnd: "2026-06-30",
  }, prisma);
  const trainingStatement = await prisma.commissionStatement.findFirstOrThrow({
    where: { periodId: trainingPeriod.id, calculationRevision: trainingPeriod.currentRevision },
  });
  const trainingSource = await prisma.commissionSourceEvent.findFirstOrThrow({
    where: { invoiceId: trainingInvoice.id },
  });
  assert.equal(trainingSource.grossAmountCents, 10_000);
  assert.equal(trainingSource.discountAmountCents, 10_000);
  assert.equal(trainingSource.netAmountCents, 0);
  assert.equal(trainingSource.grossBasisOverride, true);
  assert.equal(trainingStatement.eligibleSalesCents, 10_000);
  assert.equal(trainingStatement.finalCommissionCents, 1_000);
  assert.equal(await prisma.payment.count({ where: { invoiceId: trainingInvoice.id } }), 0);

  const payment = await prisma.payment.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      invoiceId: invoice.id,
      cashierId: calculator.id,
      amount: 90,
      method: "CASH",
    },
  });
  await prisma.paymentRefund.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      paymentId: payment.id,
      invoiceId: invoice.id,
      processedById: approver.id,
      amount: 40,
      method: "CASH",
      reason: "Commission proportional refund verification.",
    },
  });
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { paidAmount: 90, balance: 0, status: "PAID" },
  });
  const refundCapture = await captureCommissionRefundAdjustments(approverContext, prisma);
  const refundReplay = await captureCommissionRefundAdjustments(approverContext, prisma);
  assert.equal(refundCapture.insertedAdjustmentCount, 1);
  assert.equal(refundReplay.insertedAdjustmentCount, 0);
  const adjustment = await prisma.commissionAdjustment.findFirstOrThrow({
    where: { statementId: statement.id, type: "REFUND" },
  });
  assert.equal(adjustment.eligibleAmountCents, -4_000);
  assert.equal(adjustment.commissionAmountCents, -400);
  assert.equal(adjustment.payrollStatus, "FUTURE_PAYROLL_REQUIRED");
  const frozenStatement = await prisma.commissionStatement.findUniqueOrThrow({ where: { id: statement.id } });
  assert.equal(frozenStatement.finalCommissionCents, 900);
  assert.equal(Number((await prisma.payrollVariablePay.findUniqueOrThrow({ where: { id: payroll.id } })).amount), 9);
  const manualCorrection = await createManualCommissionCorrection(approverContext, {
    statementId: statement.id,
    amountCents: 125,
    reason: "Audited future incentive correction.",
  }, prisma);
  assert.equal(manualCorrection.type, "MANUAL_CORRECTION");
  assert.equal(manualCorrection.commissionAmountCents, 125);
  assert.equal(manualCorrection.payrollStatus, "FUTURE_PAYROLL_REQUIRED");
  assert.equal((await prisma.commissionStatement.findUniqueOrThrow({ where: { id: statement.id } })).finalCommissionCents, 900);

  const product = await prisma.product.create({
    data: { businessId: business.id, name: `Product ${token}`, price: 200 },
  });
  const productInvoice = await prisma.invoice.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      invoiceNumber: `COM-PRODUCT-${token}`,
      subtotal: 200,
      total: 200,
      paidAmount: 200,
      balance: 0,
      status: "PAID",
      issuedAt: new Date("2026-07-10T05:00:00.000Z"),
      items: {
        create: {
          businessId: business.id,
          productId: product.id,
          commissionMembershipId: membership.id,
          name: product.name,
          quantity: 1,
          unitPrice: 200,
          lineTotal: 200,
        },
      },
    },
  });
  await createCommissionRule(calculatorContext, {
    name: "Product 5%",
    sourceType: "PRODUCT",
    scope: "ALL",
    ruleType: "PERCENTAGE",
    basis: "NET_AFTER_DISCOUNT",
    rateBasisPoints: 500,
    effectiveFrom: "2026-01-01",
    reason: "Explicit product salesperson QA rule.",
  }, prisma);
  const productPeriod = await calculateCommissionPeriod(calculatorContext, {
    earnedPeriodStart: "2026-07-01",
    earnedPeriodEnd: "2026-07-31",
  }, prisma);
  const productStatement = await prisma.commissionStatement.findFirstOrThrow({
    where: { periodId: productPeriod.id, calculationRevision: productPeriod.currentRevision },
  });
  assert.equal(productStatement.eligibleSalesCents, 20_000);
  assert.equal(productStatement.finalCommissionCents, 1_000);
  assert.equal(await prisma.commissionSourceEvent.count({
    where: { businessId: business.id, sourceType: "PRODUCT", membershipId: membership.id },
  }), 1);
  await approveCommissionPeriod(approverContext, {
    periodId: productPeriod.id,
    expectedRevision: productPeriod.currentRevision,
    reason: "Independent product commission review.",
  }, prisma);
  await linkApprovedCommissionToPayroll(approverContext, {
    statementId: productStatement.id,
    targetPayrollMonth: "2026-10",
  }, prisma);
  await prisma.invoice.update({
    where: { id: productInvoice.id },
    data: { status: "VOID", voidedAt: new Date(), voidReason: "Commission void verification." },
  });
  const voidCapture = await captureCommissionVoidAdjustments(approverContext, prisma);
  const voidReplay = await captureCommissionVoidAdjustments(approverContext, prisma);
  assert.equal(voidCapture.insertedAdjustmentCount, 1);
  assert.equal(voidReplay.insertedAdjustmentCount, 0);
  const voidAdjustment = await prisma.commissionAdjustment.findFirstOrThrow({
    where: { statementId: productStatement.id, type: "VOID" },
  });
  assert.equal(voidAdjustment.eligibleAmountCents, -20_000);
  assert.equal(voidAdjustment.commissionAmountCents, -1_000);
  assert.equal(voidAdjustment.payrollStatus, "FUTURE_PAYROLL_REQUIRED");

  const otherBranch = await prisma.branch.create({
    data: { businessId: business.id, name: `Other Branch ${token}` },
  });
  const branchCalculatorContext: CommissionWriteContext = {
    ...calculatorContext,
    branchId: branch.id,
  };
  await assert.rejects(createCommissionRule(branchCalculatorContext, {
    name: "Unauthorized branch rule",
    sourceType: "SERVICE",
    branchId: otherBranch.id,
    scope: "ALL",
    ruleType: "PERCENTAGE",
    basis: "NET_AFTER_DISCOUNT",
    rateBasisPoints: 500,
    effectiveFrom: "2026-01-01",
    reason: "This branch scope must be rejected.",
  }, prisma), /outside the authorized branch scope/i);
  await assert.rejects(calculateCommissionPeriod(branchCalculatorContext, {
    branchId: otherBranch.id,
    earnedPeriodStart: "2026-06-01",
    earnedPeriodEnd: "2026-06-30",
  }, prisma), /outside the authorized branch scope/i);

  const other = await prisma.business.create({ data: { name: `Other ${token}`, slug: `other-commission-${token}` } });
  await assert.rejects(prisma.commissionRule.create({ data: { businessId: other.id, createdById: calculator.id, name: "Cross tenant", sourceType: "SERVICE" } }), /COMMISSION_TENANT_SCOPE_MISMATCH/);
});

function context(businessId: string, userId: string, capabilities: CommissionWriteContext["capabilities"]): CommissionWriteContext {
  return { businessId, actor: { userId, name: "QA", email: "qa@local.test" }, capabilities };
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for Commission integration tests.");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname.toLowerCase()), "Commission integration tests must use a local database.");
}

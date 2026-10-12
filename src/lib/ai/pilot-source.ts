import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateFinancialMetrics } from "@/lib/financial-metrics";
import { financialReadSnapshot } from "@/lib/reports/financial-read-snapshot";
import { aiMetric } from "./context";
import { pilotDigest, pilotPeriod, pilotProvenance } from "./pilot-boundary";
import type { resolvePilotReadGrants, PilotGrant } from "./pilot-access";
import type { AiScopeSnapshot } from "./presentation";

type Metric = ReturnType<typeof aiMetric>;
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const money = (value: number) => (value / 100).toFixed(2);
const branchWhere = (grant: PilotGrant) => grant.allBranches ? {} : grant.includeBusinessWide
  ? { OR: [{ branchId: { in: grant.branchIds } }, { branchId: null }] } : { branchId: { in: grant.branchIds } };

/** Deliberately does NOT call the full Performance, Expense dashboard, AP or
 * reconciliation readers. Only positive, separately-authorized sources exist. */
export async function readOwnerPilotContext(input: Awaited<ReturnType<typeof resolvePilotReadGrants>> & {
  period: ReturnType<typeof pilotPeriod>;
}) {
  return financialReadSnapshot(prisma, async db => {
    const metrics: Metric[] = [];
    const { business, grants, period } = input;
    const window = { gte: period.fromDate, lt: period.toDateExclusive };
    const report = grants.find(g => g.domain === "REPORTS");
    if (report) {
      const scope = { businessId: business.id, ...branchWhere(report) };
      const [invoices, payments, refunds] = await Promise.all([
        db.invoice.findMany({ where: { ...scope, status: { not: "VOID" }, issuedAt: window }, select: { total: true, tipAmount: true, discountAmount: true, loyaltyDiscountAmount: true, payments: { where: { method: "PACKAGE", status: "ACTIVE" }, select: { amount: true } } } }),
        db.payment.findMany({ where: { ...scope, status: "ACTIVE", method: { not: "PACKAGE" }, paidAt: window, AND: [{ OR: [{ invoiceId: null }, { invoice: { status: { not: "VOID" } } }] }] }, select: { amount: true, purpose: true, method: true } }),
        db.paymentRefund.findMany({ where: { ...scope, method: { not: "PACKAGE" }, refundedAt: window, AND: [{ OR: [{ invoiceId: null }, { invoice: { status: { not: "VOID" } } }] }] }, select: { amount: true, method: true, payment: { select: { purpose: true, method: true } } } }),
      ]);
      const totals = calculateFinancialMetrics({
        invoices: invoices.map(i => ({ totalCents: cents(i.total), tipCents: cents(i.tipAmount), discountCents: cents(i.discountAmount), loyaltyDiscountCents: cents(i.loyaltyDiscountAmount), packageVoucherCents: i.payments.reduce((s, p) => s + cents(p.amount), 0) })),
        payments: payments.map(p => ({ amountCents: cents(p.amount), isPackage: false, purpose: p.purpose, method: p.method })),
        refunds: refunds.map(r => ({ amountCents: cents(r.amount), isPackage: false, method: r.method, originalPayment: r.payment })),
      });
      metrics.push(aiMetric("NET_SALES", money(totals.netSalesCents)), aiMetric("GROSS_SALES", money(totals.grossSalesCents)), aiMetric("REFUNDS", money(totals.refundsCents)), aiMetric("TRANSACTIONS", totals.transactionCount), aiMetric("AVERAGE_TRANSACTION", money(totals.averageTransactionValueCents ?? 0)), aiMetric("PAYMENTS_COLLECTED", money(totals.netCollectionsCents)));
      for (const method of ["CASH", "CARD", "DUITNOW", "BANK_TRANSFER"] as const) metrics.push(aiMetric(`PAYMENTS_${method}`, money(payments.filter(p => p.method === method).reduce((s, p) => s + cents(p.amount), 0))));
    }
    const expense = grants.find(g => g.domain === "EXPENSES");
    if (expense) {
      // Positive source allowlist; no full spending total and no subtractive
      // removal. Claim amounts are already canonical confirmed Expense facts;
      // no employee, claim details, source snapshot or settlement is selected.
      const where: Prisma.BusinessExpenseWhereInput = { businessId: business.id, ...branchWhere(expense), status: "CONFIRMED", AND: [{ OR: [
        { sourceType: { in: ["MANUAL", "CLAIM"] } },
        { sourceType: "SYSTEM", recurringTemplateId: { not: null }, recurringTemplate: { businessId: business.id }, sourceId: { startsWith: "RECURRING:" } },
      ] }], expenseDate: { gte: new Date(`${period.from}T00:00:00Z`), lte: new Date(`${period.to}T00:00:00Z`) } };
      const rows = await db.businessExpense.groupBy({ by: ["sourceType"], where, _sum: { amount: true } });
      const total = rows.reduce((sum, row) => sum + cents(row._sum.amount), 0);
      metrics.push(aiMetric("RECORDED_BUSINESS_SPENDING", money(total)), aiMetric("MANUAL_SPENDING", money(rows.filter(r => r.sourceType === "MANUAL").reduce((s, r) => s + cents(r._sum.amount), 0))), aiMetric("CLAIM_SPENDING", money(rows.filter(r => r.sourceType === "CLAIM").reduce((s, r) => s + cents(r._sum.amount), 0))));
      // A partial expense-source allowlist is never called total business profit.
    }
    const inventory = grants.find(g => g.domain === "INVENTORY");
    if (inventory) {
      const products = await db.product.findMany({ where: { businessId: business.id, status: "ACTIVE", trackInventory: true }, select: { price: true, stocks: { where: { businessId: business.id, branchId: { in: inventory.branchIds } }, select: { quantity: true, reorderLevel: true } } } });
      const stocks = products.flatMap(p => p.stocks.map(s => ({ ...s, price: p.price })));
      metrics.push(aiMetric("TRACKED_PRODUCTS", products.length), aiMetric("LOW_STOCK_COUNT", stocks.filter(s => s.quantity <= s.reorderLevel).length), aiMetric("OUT_OF_STOCK_COUNT", stocks.filter(s => s.quantity <= 0).length), aiMetric("INVENTORY_SELLING_VALUE", money(stocks.reduce((sum, s) => sum + cents(s.price) * s.quantity, 0))));
    }
    const appointments = grants.find(g => g.domain === "APPOINTMENTS");
    if (appointments) {
      const rows = await db.appointment.groupBy({ by: ["status"], where: { businessId: business.id, ...branchWhere(appointments), scheduledAt: window }, _count: { _all: true } });
      const count = (statuses?: string[]) => rows.filter(r => !statuses || statuses.includes(r.status)).reduce((s, r) => s + r._count._all, 0);
      metrics.push(aiMetric("APPOINTMENTS_TOTAL", count()), aiMetric("APPOINTMENTS_SCHEDULED", count(["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE"])), aiMetric("APPOINTMENTS_COMPLETED", count(["COMPLETED", "CONVERTED_TO_JOB"])), aiMetric("APPOINTMENTS_CANCELLED", count(["CANCELLED"])), aiMetric("APPOINTMENTS_NO_SHOW", count(["NO_SHOW"])));
    }
    const { fromDate: _from, toDateExclusive: _to, ...dates } = period;
    void _from; void _to;
    const scopeSnapshot: AiScopeSnapshot = { scopeType: "BUSINESS", businessId: business.id, businessName: business.name,
      ...(input.selectedBranch ? { selectedBranchId: input.selectedBranch.id, selectedBranchName: input.selectedBranch.name } : {}), ...dates };
    const payload = { version: "owner-pilot/1", scope: { type: "BUSINESS" }, period: dates, metrics,
      coverage: grants.map(g => ({ domain: g.domain, available: true })),
      limitations: ["Confirmed Expenses include only permitted operating expense sources; they are not total business spending or accounting profit.", "Inventory quantities are a current snapshot, not historical movements.", "Missing sources are unavailable, not zero."],
    };
    return { ...pilotDigest(payload), scopeSnapshot, ownerPilot: pilotProvenance(business.id, grants), sourceDomains: grants.map(g => g.domain) };
  });
}

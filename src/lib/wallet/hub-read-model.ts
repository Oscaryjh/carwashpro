import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readWalletActivity } from "@/lib/reports/wallet-activity";
import { resolveWalletHubScope, type WalletHubContext } from "./hub-scope";

const activityTypes = ["TOP_UP", "WALLET_USED", "WALLET_REFUND", "TOP_UP_REVERSAL", "VOID_RESTORE"] as const;
export type WalletHubActivityType = typeof activityTypes[number];
export type WalletHubWindow = { fromDate: Date; toDateExclusive: Date };
export type WalletHubPageInput = { pageSize?: number; cursor?: string | null; search?: string };
export type WalletHubActivityInput = WalletHubWindow & WalletHubPageInput & { type?: string };
const windowSchema = z.object({ fromDate: z.date(), toDateExclusive: z.date() })
  .refine(input => input.fromDate < input.toDateExclusive, "Invalid resolved Wallet period.");
const pageSchema = z.object({
  pageSize: z.union([z.literal(20), z.literal(50)]).default(20),
  cursor: z.string().max(2048).nullish(), search: z.string().trim().max(160).default(""),
});
const datedCursor = z.object({ date: z.string().datetime(), id: z.string().min(1).max(80) });
const balanceCursor = z.object({ name: z.string().max(1000), id: z.string().uuid() });
const activityKey = z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decode(cursor: string): unknown { return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);
const cents = (value: number) => new Prisma.Decimal(value).div(100).toFixed(2);

/** Every Hub read has one read-only, repeatable snapshot including fresh access.
 * No writer, recovery helper, or partial reversal UX dependency belongs here. */
function snapshot<T>(db: PrismaClient, read: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function readWalletHubOverview(ctx: WalletHubContext, input: WalletHubWindow, db: PrismaClient = prisma) {
  const window = windowSchema.parse(input);
  return snapshot(db, async tx => {
    const scope = await resolveWalletHubScope(ctx, tx);
    // Deliberately NOT filtered by Branch or period: accounts are Business-wide.
    const balance = await tx.walletAccount.aggregate({ where: { businessId: scope.businessId }, _sum: { paidBalance: true, bonusBalance: true } });
    const paid = balance._sum.paidBalance ?? new Prisma.Decimal(0), bonus = balance._sum.bonusBalance ?? new Prisma.Decimal(0);
    const activity = await readWalletActivity(tx, { ...scope, from: window.fromDate, toExclusive: window.toDateExclusive });
    return {
      currentBalance: { paid: money(paid), bonus: money(bonus), total: money(paid.plus(bonus)) },
      period: {
        topUps: cents(activity.topUpPrincipalCents), topUpBonus: cents(activity.topUpBonusCents),
        walletUsed: cents(activity.redemptionPaidCents + activity.redemptionBonusCents),
        walletRefunds: cents(activity.refundPaidCents + activity.refundBonusCents),
        topUpReversals: cents(activity.reversedPrincipalCents + activity.reversedBonusCents),
        voidRestores: cents(activity.voidRestoredPaidCents + activity.voidRestoredBonusCents),
      },
      ...window, branchId: scope.branchId,
    };
  });
}

type ActivityKey = { walletAccountId: string; financialOperationId: string; date: Date; type: string; id: string };
const paymentSelect = { invoiceId: true, reference: true, method: true } as const;
const entryInclude = {
  account: { select: { customerId: true, customer: { select: { name: true } } } },
  actor: { select: { name: true } }, branch: { select: { name: true } },
  operation: { select: { state: true, operationType: true } },
  payment: { select: paymentSelect }, refund: { select: { reference: true, method: true, payment: { select: paymentSelect } } },
  topUp: { select: { payment: { select: paymentSelect } } },
  original: { select: { payment: { select: paymentSelect }, topUp: { select: { payment: { select: paymentSelect }, reversals: { select: { refund: { select: { reference: true, method: true } } } } } } } },
} satisfies Prisma.WalletTransactionInclude;
type Entry = Prisma.WalletTransactionGetPayload<{ include: typeof entryInclude }>;

function activityRow(key: ActivityKey, entries: Entry[]) {
  if (!entries.length || entries.some(entry => entry.operation.state !== "COMPLETED")) throw new Error("Wallet activity requires reconciliation.");
  const type = z.enum(activityTypes).parse(key.type);
  const last = entries[entries.length - 1];
  if (type === "VOID_RESTORE" && last.operation.operationType !== "INVOICE_VOID") throw new Error("Wallet reversal source is not an Invoice VOID.");
  const paid = entries.reduce((sum, entry) => sum.plus(entry.paidDelta), new Prisma.Decimal(0));
  const bonus = entries.reduce((sum, entry) => sum.plus(entry.bonusDelta), new Prisma.Decimal(0));
  const payment = entries.map(entry => entry.payment ?? entry.topUp?.payment ?? entry.refund?.payment ?? entry.original?.payment ?? entry.original?.topUp?.payment).find(Boolean);
  const refund = entries.map(entry => entry.refund ?? entry.original?.topUp?.reversals[0]?.refund).find(Boolean);
  return {
    id: key.id, date: key.date, customerId: last.account.customerId, customerName: last.account.customer.name,
    type, amount: money(paid.plus(bonus)), paidAmount: money(paid), bonusAmount: money(bonus),
    balanceAfterPaid: money(last.paidBalanceAfter), balanceAfterBonus: money(last.bonusBalanceAfter),
    balanceAfterTotal: money(last.paidBalanceAfter.plus(last.bonusBalanceAfter)),
    invoiceId: payment?.invoiceId ?? null, reference: refund?.reference ?? payment?.reference ?? null,
    paymentMethod: refund?.method ?? payment?.method ?? null, staffName: last.actor?.name ?? null,
    branchId: last.branchId, branchName: last.branch?.name ?? null,
  };
}

export async function readWalletHubTransactions(ctx: WalletHubContext, input: WalletHubActivityInput, db: PrismaClient = prisma) {
  const window = windowSchema.parse(input), page = pageSchema.parse(input);
  const type = input.type === undefined ? undefined : z.enum(activityTypes).parse(input.type);
  const cursor = page.cursor ? datedCursor.parse(decode(page.cursor)) : null;
  if (cursor) activityKey.parse(cursor.id);
  return snapshot(db, async tx => {
    const scope = await resolveWalletHubScope(ctx, tx);
    // Group before LIMIT and filters: never paginate raw Paid/Bonus components.
    // Dates come from the same source facts as readWalletActivity, not postedAt
    // or account.sequence (which is only ordered within one account).
    const keys = await tx.$queryRaw<ActivityKey[]>(Prisma.sql`
      WITH events AS (
        SELECT t.wallet_account_id, t.financial_operation_id, t.sequence,
          CASE WHEN t.type IN ('TOP_UP_PAID','TOP_UP_BONUS') THEN tp.paid_at
            WHEN t.type='REDEMPTION' THEN p.paid_at WHEN t.type='REFUND' THEN r.refunded_at
            WHEN t.type='REVERSAL' AND o.type IN ('TOP_UP_PAID','TOP_UP_BONUS') THEN rr.refunded_at
            ELSE t.created_at END AS event_date,
          CASE WHEN t.type IN ('TOP_UP_PAID','TOP_UP_BONUS') THEN 'TOP_UP'
            WHEN t.type='REDEMPTION' THEN 'WALLET_USED' WHEN t.type='REFUND' THEN 'WALLET_REFUND'
            WHEN t.type='REVERSAL' AND o.type IN ('TOP_UP_PAID','TOP_UP_BONUS') THEN 'TOP_UP_REVERSAL'
            WHEN t.type='REVERSAL' AND o.type='REDEMPTION' THEN 'VOID_RESTORE'
            ELSE 'UNSUPPORTED' END AS activity_type
        FROM wallet_transactions t
        LEFT JOIN wallet_transactions o ON o.business_id=t.business_id AND o.id=t.original_transaction_id
        LEFT JOIN wallet_top_ups tu ON tu.business_id=t.business_id AND tu.id=COALESCE(t.top_up_id,o.top_up_id)
        LEFT JOIN payments tp ON tp.business_id=t.business_id AND tp.id=tu.external_payment_id
        LEFT JOIN payments p ON p.business_id=t.business_id AND p.id=t.payment_id
        LEFT JOIN payment_refunds r ON r.business_id=t.business_id AND r.id=t.refund_id
        LEFT JOIN wallet_top_up_reversals tr ON tr.business_id=t.business_id AND tr.top_up_id=o.top_up_id AND tr.financial_operation_id=t.financial_operation_id
        LEFT JOIN payment_refunds rr ON rr.business_id=t.business_id AND rr.id=tr.external_refund_id
        WHERE t.business_id=${scope.businessId}::uuid
      ), activities AS (
        SELECT wallet_account_id, financial_operation_id, MAX(sequence) AS last_sequence,
          MAX(event_date) AS date, MAX(activity_type) AS type,
          wallet_account_id::text || ':' || financial_operation_id::text AS id
        FROM events GROUP BY wallet_account_id, financial_operation_id
      )
      SELECT a.wallet_account_id AS "walletAccountId", a.financial_operation_id AS "financialOperationId", a.date, a.type, a.id
      FROM activities a
      JOIN wallet_transactions last ON last.business_id=${scope.businessId}::uuid AND last.wallet_account_id=a.wallet_account_id AND last.sequence=a.last_sequence
      JOIN wallet_accounts wa ON wa.business_id=last.business_id AND wa.id=a.wallet_account_id
      JOIN customers c ON c.business_id=wa.business_id AND c.id=wa.customer_id
      WHERE a.date>=${window.fromDate.toISOString()}::timestamp AND a.date<${window.toDateExclusive.toISOString()}::timestamp
        ${scope.branchId ? Prisma.sql`AND last.branch_id=${scope.branchId}::uuid` : Prisma.empty}
        ${page.search ? Prisma.sql`AND position(lower(${page.search}) in lower(c.name))>0` : Prisma.empty}
        ${type ? Prisma.sql`AND a.type=${type}` : Prisma.empty}
        ${cursor ? Prisma.sql`AND (a.date, a.id)<(${cursor.date}::timestamp, ${cursor.id}::text)` : Prisma.empty}
      ORDER BY a.date DESC, a.id DESC LIMIT ${page.pageSize + 1}
    `);
    const selected = keys.slice(0, page.pageSize);
    const entries = selected.length ? await tx.walletTransaction.findMany({
      where: { businessId: scope.businessId, OR: selected.map(key => ({ walletAccountId: key.walletAccountId, financialOperationId: key.financialOperationId })) },
      include: entryInclude, orderBy: { sequence: "asc" },
    }) : [];
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      const id = `${entry.walletAccountId}:${entry.financialOperationId}`;
      const group = groups.get(id) ?? []; group.push(entry); groups.set(id, group);
    }
    const end = selected.at(-1);
    return { rows: selected.map(key => activityRow(key, groups.get(key.id) ?? [])),
      nextCursor: keys.length > page.pageSize && end ? encode({ date: end.date.toISOString(), id: end.id }) : null };
  });
}

export async function readWalletHubTopUps(ctx: WalletHubContext, input: WalletHubWindow & WalletHubPageInput, db: PrismaClient = prisma) {
  const window = windowSchema.parse(input), page = pageSchema.parse(input);
  const cursor = page.cursor ? datedCursor.parse(decode(page.cursor)) : null;
  if (cursor) z.string().uuid().parse(cursor.id);
  return snapshot(db, async tx => {
    const scope = await resolveWalletHubScope(ctx, tx);
    const rows = await tx.walletTopUp.findMany({
      where: { businessId: scope.businessId, ...(scope.branchId ? { branchId: scope.branchId } : {}),
        payment: { paidAt: { gte: window.fromDate, lt: window.toDateExclusive } },
        ...(page.search ? { account: { customer: { name: { contains: page.search, mode: "insensitive" } } } } : {}),
        ...(cursor ? { OR: [{ payment: { paidAt: { lt: new Date(cursor.date) } } }, { payment: { paidAt: new Date(cursor.date) }, id: { lt: cursor.id } }] } : {}),
      }, take: page.pageSize + 1, orderBy: [{ payment: { paidAt: "desc" } }, { id: "desc" }],
      include: { account: { select: { customerId: true, customer: { select: { name: true } } } },
        payment: { select: { ...paymentSelect, paidAt: true } }, actor: { select: { name: true } },
        branch: { select: { name: true } }, reversals: { select: { id: true } } },
    });
    const selected = rows.slice(0, page.pageSize), end = selected.at(-1);
    return { rows: selected.map(row => ({ topUpId: row.id, date: row.payment.paidAt,
      customerId: row.account.customerId, customerName: row.account.customer.name,
      paidAmount: money(row.paidAmount), bonusAmount: money(row.bonusAmount), totalAdded: money(row.totalCredited),
      paymentMethod: row.payment?.method ?? null, reference: row.payment?.reference ?? null,
      staffName: row.actor?.name ?? null, branchId: row.branchId, branchName: row.branch?.name ?? null,
      status: row.reversals.length ? "Reversed" as const : "Posted" as const,
    })), nextCursor: rows.length > page.pageSize && end ? encode({ date: end.payment.paidAt.toISOString(), id: end.id }) : null };
  });
}

export async function readWalletHubCustomerBalances(ctx: WalletHubContext, input: WalletHubPageInput = {}, db: PrismaClient = prisma) {
  const page = pageSchema.parse(input);
  const cursor = page.cursor ? balanceCursor.parse(decode(page.cursor)) : null;
  return snapshot(db, async tx => {
    const scope = await resolveWalletHubScope(ctx, tx);
    const rows = await tx.walletAccount.findMany({
      where: { businessId: scope.businessId,
        ...(page.search ? { customer: { name: { contains: page.search, mode: "insensitive" } } } : {}),
        ...(cursor ? { OR: [{ customer: { name: { gt: cursor.name } } }, { customer: { name: cursor.name }, id: { gt: cursor.id } }] } : {}),
      }, include: { customer: { select: { name: true } } },
      orderBy: [{ customer: { name: "asc" } }, { id: "asc" }], take: page.pageSize + 1,
    });
    const selected = rows.slice(0, page.pageSize), end = selected.at(-1);
    const last = selected.length ? await tx.walletTransaction.groupBy({ by: ["walletAccountId"],
      where: { businessId: scope.businessId, walletAccountId: { in: selected.map(row => row.id) } }, _max: { createdAt: true },
    }) : [];
    const lastByAccount = new Map(last.map(row => [row.walletAccountId, row._max.createdAt]));
    return { rows: selected.map(row => ({ customerId: row.customerId, customerName: row.customer.name,
      paidBalance: money(row.paidBalance), bonusBalance: money(row.bonusBalance), totalBalance: money(row.paidBalance.plus(row.bonusBalance)),
      lastActivityAt: lastByAccount.get(row.id) ?? null,
    })), nextCursor: rows.length > page.pageSize && end ? encode({ name: end.customer.name, id: end.id }) : null };
  });
}

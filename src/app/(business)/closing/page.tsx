import Link from "next/link";
import type { PaymentMethod, PaymentRecordStatus } from "@prisma/client";
import { DailyClosingSnapshotPanel } from "@/components/daily-closing-snapshot-panel";
import { getOperationalBranches } from "@/lib/branches";
import {
  BUSINESS_TIME_ZONE,
  formatDateValue,
  getBusinessTodayDateValue,
  isValidDateValue,
} from "@/lib/business-time";
import { formatMoneyFromCents } from "@/lib/daily-closing/format";
import { getDailyClosingReport } from "@/lib/daily-closing/query";
import { getDailyClosingRange } from "@/lib/daily-closing/range";
import {
  getExpectedCashCents,
  isDailyClosingSnapshotPayload,
  normalizeBusinessDate,
} from "@/lib/daily-closing/snapshot";
import { isDailyClosingIndustry } from "@/lib/daily-closing/types";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { fromCents, toCents } from "@/lib/validation/pos";
import { endShiftAction, startShiftAction } from "./actions";

type ClosingPageProps = {
  searchParams: Promise<{
    activityPage?: string;
    message?: string;
    shiftPage?: string;
    type?: string;
    branchId?: string;
    date?: string;
  }>;
};

const ACTIVITY_PAGE_SIZE = 10;
const SHIFT_PAGE_SIZE = 10;

const paymentMethodLabels: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  CASH: "Cash",
  DUITNOW: "DuitNow",
  EWALLET: "E-wallet",
  PACKAGE: "Package use",
};

export default async function ClosingPage({ searchParams }: ClosingPageProps) {
  const context = await requireBusinessContext();
  const params = await searchParams;
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const todayDateValue = getBusinessTodayDateValue();
  const requestedDate =
    params.date && isValidDateValue(params.date)
      ? params.date
      : todayDateValue;
  const requestedActivityPage = Math.max(
    1,
    Number.parseInt(params.activityPage ?? "1", 10) || 1,
  );
  const requestedShiftPage = Math.max(
    1,
    Number.parseInt(params.shiftPage ?? "1", 10) || 1,
  );

  if (!context.businessId) {
    return (
      <>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
            <Link href="/login">Back to login</Link>
          </div>
        </section>
      </>
    );
  }

  const businessId = context.businessId;
  const closingIndustry = isDailyClosingIndustry(context.industryType)
    ? context.industryType
    : null;
  const todayRange = getDailyClosingRange(undefined, requestedDate);
  const { dateValue, fromDate, toDateExclusive } = todayRange;
  const isOwner = context.user.role === "BUSINESS_OWNER";
  const [branches, openShift, shifts] = await Promise.all([
    getOperationalBranches(businessId, context.user),
    prisma.cashierShift.findFirst({
      where: {
        businessId,
        cashierId: context.user.userId,
        status: "OPEN",
      },
      include: {
        branch: true,
        cashier: {
          select: { name: true },
        },
        payments: {
          where: { status: "ACTIVE" },
          orderBy: { paidAt: "desc" },
        },
        refunds: {
          orderBy: { refundedAt: "desc" },
        },
      },
    }),
    prisma.cashierShift.findMany({
      where: {
        businessId,
        ...(isOwner ? {} : { cashierId: context.user.userId }),
        OR: [
          { startedAt: { gte: fromDate, lt: toDateExclusive } },
          { endedAt: { gte: fromDate, lt: toDateExclusive } },
          { status: "OPEN" },
        ],
      },
      include: {
        branch: true,
        cashier: {
          select: { name: true },
        },
        payments: {
          where: { status: "ACTIVE" },
          orderBy: { paidAt: "desc" },
        },
        refunds: {
          orderBy: { refundedAt: "desc" },
        },
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const selectedBranch =
    branches.find((branch) => branch.id === params.branchId) ??
    (openShift ? branches.find((branch) => branch.id === openShift.branchId) : undefined) ??
    branches[0] ??
    null;
  const existingSnapshot = selectedBranch
    ? await prisma.dailyClosingSnapshot.findUnique({
        where: {
          businessId_branchId_businessDate: {
            branchId: selectedBranch.id,
            businessDate: normalizeBusinessDate(dateValue),
            businessId,
          },
        },
        include: {
          closingWhatsAppSends: {
            include: {
              recipient: {
                select: {
                  label: true,
                  role: true,
                },
              },
              requestedBy: {
                select: { name: true },
              },
            },
            orderBy: { requestedAt: "desc" },
          },
          closedBy: {
            select: { name: true },
          },
        },
      })
    : null;
  const snapshotPayload =
    existingSnapshot &&
    isDailyClosingSnapshotPayload(existingSnapshot.reportDataJson)
      ? existingSnapshot.reportDataJson
      : null;
  const dailyClosing = selectedBranch && closingIndustry
    ? snapshotPayload
      ? {
          branchId: snapshotPayload.branch.id,
          branchName: snapshotPayload.branch.name,
          businessName: snapshotPayload.business.name,
          dateValue: snapshotPayload.businessDate,
          fromDate,
          generatedAt: new Date(snapshotPayload.generatedAt),
          generatedAtLabel: formatSnapshotDateTime(
            new Date(snapshotPayload.generatedAt),
          ),
          industry: closingIndustry,
          preview: existingSnapshot?.whatsappText ?? "",
          report: snapshotPayload.report,
          timeZone: snapshotPayload.timezone,
          toDateExclusive,
        }
      : existingSnapshot
        ? null
        : await getDailyClosingReport({
            branchId: selectedBranch.id,
            businessId,
            dateValue,
            industryType: closingIndustry,
          })
    : null;
  const currentShiftSummary = openShift
    ? summarizePayments(openShift.payments, openShift.refunds)
    : null;
  const allActivities = buildShiftActivities(openShift ? [openShift] : shifts);
  const activityPageCount = Math.max(1, Math.ceil(allActivities.length / ACTIVITY_PAGE_SIZE));
  const activityPage = Math.min(requestedActivityPage, activityPageCount);
  const activityStart = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
  const visibleActivities = allActivities.slice(
    activityStart,
    activityStart + ACTIVITY_PAGE_SIZE,
  );
  const shiftPageCount = Math.max(1, Math.ceil(shifts.length / SHIFT_PAGE_SIZE));
  const shiftPage = Math.min(requestedShiftPage, shiftPageCount);
  const shiftStart = (shiftPage - 1) * SHIFT_PAGE_SIZE;
  const visibleShifts = shifts.slice(shiftStart, shiftStart + SHIFT_PAGE_SIZE);
  const canStartShift = isOwner || branches.length > 0;

  return (
    <>
      <section className="content report-content closing-content">
        <div className="page-header report-header closing-page-header">
          <div>
            <h1>Shift Closing</h1>
            <p>Cashier shift closing and daily business summary.</p>
          </div>
          <div className="report-period closing-period">
            <span>{dateValue === todayDateValue ? "Today" : "Business date"}</span>
            <strong>{formatBusinessDate(dateValue)}</strong>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <section className="report-grid closing-overview-grid">
          <div className="panel report-card closing-shift-card">
            <div className="section-header">
              <h2>{openShift ? "Current shift" : "Start shift"}</h2>
              {openShift ? <span className="status">open</span> : null}
            </div>
            {openShift ? (
              <div className="closing-shift-panel">
                <div className="report-kpis compact-kpis closing-shift-kpis">
                  <Metric label="Cashier" value={openShift.cashier.name} />
                  <Metric label="Branch" value={openShift.branch?.name ?? "All branches"} />
                  <Metric label="Started" value={formatDateTime(openShift.startedAt)} />
                  <Metric label="Opening Float" value={money(openShift.openingFloat)} />
                  <Metric
                    label="Net Cash Sales"
                    value={money(currentShiftSummary?.cashAmount ?? 0)}
                  />
                  <Metric
                    label="Expected Cash"
                    value={money(
                      Number(openShift.openingFloat) +
                        Number(currentShiftSummary?.cashAmount ?? 0),
                    )}
                  />
                </div>
                <form action={endShiftAction} className="form closing-form closing-end-form">
                  <input type="hidden" name="shiftId" value={openShift.id} />
                  <div className="field-grid closing-field-grid">
                    <label>
                      <span>Cash counted</span>
                      <input
                        inputMode="decimal"
                        min="0"
                        name="closingCash"
                        placeholder="0.00"
                        required
                        step="0.01"
                        type="number"
                      />
                    </label>
                    <label>
                      <span>Notes required if cash is short or over</span>
                      <input name="notes" placeholder="Reason for any difference" />
                    </label>
                  </div>
                  <div className="form-actions closing-form-actions">
                    <button type="submit">End shift</button>
                  </div>
                </form>
              </div>
            ) : (
              <form action={startShiftAction} className="form closing-form">
                {canStartShift ? (
                  <>
                    <div className="field-grid">
                      <label>
                        <span>Branch</span>
                        {isOwner && branches.length ? (
                          <select
                            name="branchId"
                            defaultValue={branches.length === 1 ? branches[0].id : ""}
                            required
                          >
                            <option value="" disabled>
                              Select branch
                            </option>
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        ) : isOwner ? (
                          <>
                            <input type="hidden" name="branchId" value="" />
                            <input value="All branches" readOnly className="read-only-field" />
                          </>
                        ) : (
                          <>
                            <input type="hidden" name="branchId" value={branches[0].id} />
                            <input value={branches[0].name} readOnly className="read-only-field" />
                          </>
                        )}
                      </label>
                      <label>
                        <span>Opening cash float</span>
                        <input
                          defaultValue="0.00"
                          inputMode="decimal"
                          min="0"
                          name="openingFloat"
                          required
                          step="0.01"
                          type="number"
                        />
                      </label>
                    </div>
                    <div className="form-actions">
                      <button type="submit">Start shift</button>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">
                    This staff account is not assigned to an active branch.
                  </p>
                )}
              </form>
            )}
          </div>

          <ReportCard title="Current Shift Totals" className="closing-total-card">
            {currentShiftSummary ? (
              <div className="report-kpis compact-kpis closing-total-kpis">
                <Metric
                  label="Gross Collected"
                  value={money(currentShiftSummary.grossCollected)}
                />
                <Metric label="Refunds" value={money(currentShiftSummary.refunded)} />
                <Metric label="Net Collected" value={money(currentShiftSummary.collected)} />
                <Metric label="Payments" value={currentShiftSummary.paymentCount} />
                <Metric label="Net Cash" value={money(currentShiftSummary.cashAmount)} />
                <Metric label="Package Uses" value={`${currentShiftSummary.packageUses} uses`} />
              </div>
            ) : (
              <p className="empty-state">Start a shift to begin closing tracking.</p>
            )}
          </ReportCard>
        </section>

        {dailyClosing ? (
          <>
            <DailyClosingSummary
              dailyClosing={dailyClosing}
              branches={branches}
              isFrozen={Boolean(existingSnapshot)}
            />
            <DailyClosingSnapshotPanel
              branchId={dailyClosing.branchId}
              branchName={dailyClosing.branchName}
              businessDate={dailyClosing.dateValue}
              expectedCashCents={
                snapshotPayload?.cash.expectedCents ??
                getExpectedCashCents(dailyClosing.report)
              }
              snapshot={
                existingSnapshot && snapshotPayload
                  ? {
                      actualCashCents: snapshotPayload.cash.actualCents,
                      cashDifferenceCents:
                        snapshotPayload.cash.differenceCents,
                      closedAtLabel: formatSnapshotDateTime(
                        existingSnapshot.closedAt,
                      ),
                      closedByName:
                        existingSnapshot.closedBy.name ||
                        snapshotPayload.closedBy.name,
                      closingNote: snapshotPayload.closingNote,
                      expectedCashCents: snapshotPayload.cash.expectedCents,
                      whatsappSends: existingSnapshot.closingWhatsAppSends.map(
                        (send) => ({
                          completedAtLabel: send.completedAt
                            ? formatSnapshotDateTime(send.completedAt)
                            : null,
                          errorMessage: send.errorMessage,
                          id: send.id,
                          phone: send.phone,
                          reason: send.reason,
                          recipientLabel: send.recipient?.label ?? send.phone,
                          recipientRole: send.recipient?.role ?? null,
                          requestedAtLabel: formatSnapshotDateTime(send.requestedAt),
                          requestedByName: send.requestedBy?.name ?? null,
                          sendType: send.sendType,
                          status: send.status,
                          trigger: send.trigger,
                        }),
                      ),
                    }
                  : null
              }
            />
          </>
        ) : existingSnapshot ? (
          <div className="panel daily-closing-empty error">
            <h2>Frozen report cannot be displayed</h2>
            <p>
              This closing snapshot has an unsupported report format. Its stored
              data was not recalculated or replaced.
            </p>
          </div>
        ) : (
          <div className="panel daily-closing-empty">
            <h2>Daily Closing Report</h2>
            <p className="empty-state">
              Assign this account to an active branch to view today&apos;s business summary.
            </p>
          </div>
        )}

        <section className="report-grid closing-activity-grid">
          <ReportCard
            title={
              isOwner
                ? `${dateValue === todayDateValue ? "Today's" : "Business day"} Shifts`
                : "My Shifts"
            }
            className="closing-table-card"
          >
            {shifts.length ? (
              <div className="table-scroll">
                <table className="table compact-table closing-shifts-table">
                  <thead>
                    <tr>
                      <th>Cashier</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Gross</th>
                      <th>Refunds</th>
                      <th>Net</th>
                      <th>Expected Cash</th>
                      <th>Counted</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShifts.map((shift) => {
                      const summary = summarizePayments(shift.payments, shift.refunds);
                      const expectedCash =
                        shift.expectedCash ??
                        Number(shift.openingFloat) + summary.cashAmount;

                      return (
                        <tr key={shift.id}>
                          <td>{shift.cashier.name}</td>
                          <td>{shift.branch?.name ?? "All branches"}</td>
                          <td>{formatStatus(shift.status)}</td>
                          <td>{formatDateTime(shift.startedAt)}</td>
                          <td>{shift.endedAt ? formatDateTime(shift.endedAt) : "-"}</td>
                          <td>{money(summary.grossCollected)}</td>
                          <td>{money(summary.refunded)}</td>
                          <td>{money(summary.collected)}</td>
                          <td>{money(expectedCash)}</td>
                          <td>{shift.closingCash == null ? "-" : money(shift.closingCash)}</td>
                          <td>{formatDifference(shift.cashDifference)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">No shifts today.</p>
            )}
            {shifts.length > SHIFT_PAGE_SIZE ? (
              <div className="pagination">
                <Link
                  className={shiftPage <= 1 ? "disabled" : ""}
                  href={makeClosingHref(params, { shiftPage: Math.max(1, shiftPage - 1) })}
                >
                  Previous
                </Link>
                <span>
                  {shiftStart + 1}-
                  {Math.min(shiftStart + SHIFT_PAGE_SIZE, shifts.length)} of {shifts.length}
                </span>
                <Link
                  className={shiftPage >= shiftPageCount ? "disabled" : ""}
                  href={makeClosingHref(params, {
                    shiftPage: Math.min(shiftPageCount, shiftPage + 1),
                  })}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </ReportCard>

          <ReportCard
            title={openShift ? "Current Shift Activity" : "Recent Shift Activity"}
            className="closing-table-card"
          >
            {visibleActivities.length ? (
              <div className="table-scroll">
                <table className="table compact-table closing-payments-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleActivities.map((activity) => (
                      <tr key={activity.id}>
                        <td>{formatTime(activity.occurredAt)}</td>
                        <td>{paymentMethodLabels[activity.method]}</td>
                        <td>
                          {activity.method === "PACKAGE"
                            ? `${activity.packageUses} use${activity.packageUses === 1 ? "" : "s"}`
                            : activity.type === "refund"
                              ? `-${money(activity.amount)}`
                              : money(activity.amount)}
                        </td>
                        <td>{activity.status}</td>
                        <td>{activity.reference || activity.detail || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">No payment or refund records for this shift.</p>
            )}
            {allActivities.length > ACTIVITY_PAGE_SIZE ? (
              <div className="pagination">
                <Link
                  className={activityPage <= 1 ? "disabled" : ""}
                  href={makeClosingHref(params, {
                    activityPage: Math.max(1, activityPage - 1),
                  })}
                >
                  Previous
                </Link>
                <span>
                  {activityStart + 1}-
                  {Math.min(activityStart + ACTIVITY_PAGE_SIZE, allActivities.length)} of{" "}
                  {allActivities.length}
                </span>
                <Link
                  className={activityPage >= activityPageCount ? "disabled" : ""}
                  href={makeClosingHref(params, {
                    activityPage: Math.min(activityPageCount, activityPage + 1),
                  })}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </ReportCard>
        </section>
      </section>
    </>
  );
}

function makeClosingHref(
  params: Awaited<ClosingPageProps["searchParams"]>,
  pages: {
    activityPage?: number;
    shiftPage?: number;
  },
) {
  const query = new URLSearchParams();
  const activityPage =
    pages.activityPage ??
    Math.max(1, Number.parseInt(params.activityPage ?? "1", 10) || 1);
  const shiftPage =
    pages.shiftPage ??
    Math.max(1, Number.parseInt(params.shiftPage ?? "1", 10) || 1);

  if (params.message) query.set("message", params.message);
  if (params.type) query.set("type", params.type);
  if (params.branchId) query.set("branchId", params.branchId);
  if (params.date) query.set("date", params.date);
  if (activityPage > 1) query.set("activityPage", String(activityPage));
  if (shiftPage > 1) query.set("shiftPage", String(shiftPage));

  const search = query.toString();
  return search ? `/closing?${search}` : "/closing";
}

type ShiftActivity = {
  amount: number;
  detail: string | null;
  id: string;
  method: PaymentMethod;
  occurredAt: Date;
  packageUses: number;
  reference: string | null;
  status: string;
  type: "payment" | "refund";
};

function buildShiftActivities(
  shifts: {
    payments: {
      amount: unknown;
      id: string;
      method: PaymentMethod;
      packageUses: number;
      paidAt: Date;
      reference: string | null;
      status: PaymentRecordStatus;
    }[];
    refunds: {
      amount: unknown;
      id: string;
      method: PaymentMethod;
      packageUsesRestored: number;
      reason: string;
      reference: string | null;
      refundedAt: Date;
    }[];
  }[],
) {
  const activities: ShiftActivity[] = [];

  for (const shift of shifts) {
    for (const payment of shift.payments) {
      activities.push({
        amount: Number(payment.amount ?? 0),
        detail: null,
        id: `payment-${payment.id}`,
        method: payment.method,
        occurredAt: payment.paidAt,
        packageUses: payment.packageUses,
        reference: payment.reference,
        status: formatPaymentStatus(payment.status),
        type: "payment",
      });
    }

    for (const refund of shift.refunds) {
      activities.push({
        amount: Number(refund.amount ?? 0),
        detail: refund.reason,
        id: `refund-${refund.id}`,
        method: refund.method,
        occurredAt: refund.refundedAt,
        packageUses: refund.packageUsesRestored,
        reference: refund.reference,
        status: "refund",
        type: "refund",
      });
    }
  }

  return activities.sort(
    (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
  );
}

function summarizePayments(
  payments: {
    amount: unknown;
    method: PaymentMethod;
    packageUses: number;
  }[],
  refunds: {
    amount: unknown;
    method: PaymentMethod;
    packageUsesRestored: number;
  }[],
) {
  let grossCollectedCents = 0;
  let refundedCents = 0;
  let grossCashCents = 0;
  let refundedCashCents = 0;
  let packageUses = 0;
  let packageUsesRestored = 0;
  let paymentCount = 0;

  for (const payment of payments) {
    if (payment.method === "PACKAGE") {
      packageUses += payment.packageUses;
      continue;
    }

    const amountCents = toCents(payment.amount ?? 0);
    grossCollectedCents += amountCents;
    paymentCount += 1;

    if (payment.method === "CASH") {
      grossCashCents += amountCents;
    }
  }

  for (const refund of refunds) {
    if (refund.method === "PACKAGE") {
      packageUsesRestored += refund.packageUsesRestored;
      continue;
    }

    const amountCents = toCents(refund.amount ?? 0);
    refundedCents += amountCents;

    if (refund.method === "CASH") {
      refundedCashCents += amountCents;
    }
  }

  return {
    cashAmount: fromCents(grossCashCents - refundedCashCents),
    collected: fromCents(grossCollectedCents - refundedCents),
    grossCollected: fromCents(grossCollectedCents),
    packageUses: Math.max(0, packageUses - packageUsesRestored),
    paymentCount,
    refunded: fromCents(refundedCents),
  };
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="report-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel report-card${className ? ` ${className}` : ""}`}>
      <div className="section-header">
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function money(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

function formatDifference(value: unknown) {
  if (value == null) {
    return "-";
  }

  const amount = Number(value);

  if (amount === 0) {
    return <span className="closing-difference balanced">Balanced</span>;
  }

  return amount < 0 ? (
    <span className="closing-difference short">Short {money(Math.abs(amount))}</span>
  ) : (
    <span className="closing-difference over">Over {money(amount)}</span>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatPaymentStatus(status: PaymentRecordStatus) {
  return status.toLowerCase();
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

function formatTime(value: Date) {
  return value.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

function formatBusinessDate(dateValue: string) {
  return formatDateValue(dateValue, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSnapshotDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
  });
}

type DailyClosingResult = Awaited<ReturnType<typeof getDailyClosingReport>>;

function DailyClosingSummary({
  dailyClosing,
  branches,
  isFrozen,
}: {
  dailyClosing: DailyClosingResult;
  branches: Awaited<ReturnType<typeof getOperationalBranches>>;
  isFrozen: boolean;
}) {
  const report = dailyClosing.report;
  const operationUnit =
    dailyClosing.industry === "AUTO_DETAILING" ? "Work orders" : "Appointments";

  return (
    <section className="panel daily-closing-report" aria-labelledby="daily-closing-title">
      <div className="daily-closing-header">
        <div>
          <span className="daily-closing-eyebrow">DAILY CLOSING REPORT</span>
          <h2 id="daily-closing-title">{dailyClosing.branchName}</h2>
          <p>
            {formatBusinessDate(dailyClosing.dateValue)} | {dailyClosing.timeZone} |{" "}
            {isFrozen ? "Frozen closing snapshot" : "Live operational summary"}
          </p>
        </div>
        <form method="get" className="daily-closing-branch-form">
          <input type="hidden" name="date" value={dailyClosing.dateValue} />
          <label>
            <span>Branch</span>
            <select name="branchId" defaultValue={dailyClosing.branchId}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            View
          </button>
        </form>
      </div>

      <div className="daily-closing-kpis">
        <ClosingMetric label="Gross sales" value={formatMoneyFromCents(report.financial.grossSalesCents)} />
        <ClosingMetric label="Collected" value={formatMoneyFromCents(report.financial.collectedCents)} />
        <ClosingMetric label="Outstanding" value={formatMoneyFromCents(report.financial.outstandingCents)} />
        <ClosingMetric label="Discounts" value={formatMoneyFromCents(report.financial.discountsCents)} />
        <ClosingMetric label="Refunds" value={formatMoneyFromCents(report.financial.refundsCents)} />
        <ClosingMetric label="Net sales" value={formatMoneyFromCents(report.financial.netSalesCents)} emphasis />
      </div>

      <div className="daily-closing-columns">
        <section className="daily-closing-section">
          <div className="daily-closing-section-heading">
            <div>
              <h3>Payment breakdown</h3>
              <p>Actual active payments less refunds. Package voucher use is excluded.</p>
            </div>
          </div>
          <div className="daily-closing-table-wrap">
            <table className="table compact-table daily-closing-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Collected</th>
                  <th>Refunded</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {report.paymentMethods.map((payment) => (
                  <tr key={payment.method}>
                    <td>{dailyPaymentMethodLabel(payment.method)}</td>
                    <td>{formatMoneyFromCents(payment.grossCents)}</td>
                    <td>{formatMoneyFromCents(payment.refundCents)}</td>
                    <td>
                      <strong>{formatMoneyFromCents(payment.netCents)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="daily-closing-section">
          <div className="daily-closing-section-heading">
            <div>
              <h3>Operations</h3>
              <p>{operationUnit}, customers and invoice status for this business day.</p>
            </div>
          </div>
          <dl className="daily-closing-facts">
            <ClosingFact label={`${operationUnit} completed`} value={report.operations.completed} />
            <ClosingFact label={`${operationUnit} cancelled`} value={report.operations.cancelled} />
            <ClosingFact label="Customers served" value={report.operations.customersServed} />
            <ClosingFact label="New customers" value={report.operations.newCustomers} />
            <ClosingFact label="Returning customers" value={report.operations.returningCustomers} />
            {dailyClosing.industry === "AUTO_DETAILING" ? (
              <ClosingFact label="Vehicles served" value={report.operations.vehiclesServed} />
            ) : null}
            <ClosingFact
              label="Average spend"
              value={formatMoneyFromCents(report.operations.averageSpendCents)}
            />
            <ClosingFact label="Invoices" value={report.invoiceCounts.total} />
            <ClosingFact label="Paid" value={report.invoiceCounts.paid} />
            <ClosingFact label="Partial" value={report.invoiceCounts.partial} />
            <ClosingFact label="Unpaid" value={report.invoiceCounts.unpaid} />
            <ClosingFact label="Refunded" value={report.invoiceCounts.refunded} />
          </dl>
          {dailyClosing.industry === "AUTO_DETAILING" ? (
            <p className="daily-closing-note">
              Cancelled work orders use records created today because the current Auto schema has no
              cancellation timestamp.
            </p>
          ) : null}
        </section>
      </div>

      <div className="daily-closing-columns daily-closing-lower">
        <section className="daily-closing-section">
          <div className="daily-closing-section-heading">
            <div>
              <h3>Top services</h3>
              <p>
                Top 3 from completed appointments or work orders, before order-level
                discounts.
              </p>
            </div>
          </div>
          {report.topServices.length ? (
            <ol className="daily-closing-ranking">
              {report.topServices.map((service) => (
                <li key={service.serviceId}>
                  <span>{service.name}</span>
                  <small>{service.quantity} sold</small>
                  <strong>{formatMoneyFromCents(service.salesCents)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">No service sales today.</p>
          )}
        </section>

        <section className="daily-closing-section">
          <div className="daily-closing-section-heading">
            <div>
              <h3>Packages</h3>
              <p>Sales and voucher usage recorded today.</p>
            </div>
          </div>
          <dl className="daily-closing-facts package-facts">
            <ClosingFact label="Packages sold" value={report.packages.sold} />
            <ClosingFact
              label="Package sales"
              value={formatMoneyFromCents(report.packages.amountCents)}
            />
            <ClosingFact label="Voucher redemptions" value={report.packages.redemptions} />
          </dl>
        </section>
      </div>

      <div className="daily-closing-columns daily-closing-lower">
        <section className="daily-closing-section">
          <div className="daily-closing-section-heading">
            <div>
              <h3>Alerts</h3>
              <p>Deterministic checks based on today&apos;s records.</p>
            </div>
          </div>
          <ul className="daily-closing-alerts">
            {report.alerts.map((alert) => (
              <li key={alert.message} className={alert.level}>
                {alert.message}
              </li>
            ))}
          </ul>
        </section>

        <section className="daily-closing-section daily-closing-preview">
          <div className="daily-closing-section-heading">
            <div>
              <h3>WhatsApp Preview</h3>
              <p>Fixed preview only. No message will be sent in this phase.</p>
            </div>
            <span className="status">Preview only</span>
          </div>
          <pre>{dailyClosing.preview}</pre>
        </section>
      </div>

      <footer className="daily-closing-footer">
        <span>
          Generated {dailyClosing.generatedAtLabel} · {dailyClosing.businessName}
        </span>
        <span>
          Scope: business + branch · {formatBusinessDate(dailyClosing.dateValue)} 00:00 to next
          day 00:00
        </span>
      </footer>
    </section>
  );
}

function ClosingMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "daily-closing-kpi emphasis" : "daily-closing-kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ClosingFact({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function dailyPaymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    BANK_TRANSFER: "Bank",
    CARD: "Card",
    CASH: "Cash",
    DUITNOW: "DuitNow",
    EWALLET: "E-wallet",
  };
  return labels[method] ?? method;
}

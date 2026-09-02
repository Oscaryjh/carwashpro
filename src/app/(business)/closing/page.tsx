import Link from "next/link";
import type { PaymentMethod, PaymentRecordStatus } from "@prisma/client";
import { DailyClosingSnapshotPanel } from "@/components/daily-closing-snapshot-panel";
import { getOperationalBranches } from "@/lib/branches";
import { getCurrentBusinessDateValue } from "@/lib/business-day";
import {
  formatDateValue,
  isValidDateValue,
} from "@/lib/business-time";
import { formatMoneyFromCents } from "@/lib/daily-closing/format";
import { getDailyClosingReport } from "@/lib/daily-closing/query";
import { getDailyClosingRange } from "@/lib/daily-closing/range";
import {
  getExpectedCashCents,
  getSnapshotBusinessDayCutoffTime,
  isDailyClosingSnapshotPayload,
  normalizeBusinessDate,
} from "@/lib/daily-closing/snapshot";
import { isDailyClosingIndustry } from "@/lib/daily-closing/types";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { fromCents, sumMoneyAmounts, toCents } from "@/lib/validation/pos";
import { endShiftAction, resolveStaleShiftAction, startShiftAction } from "./actions";

type ClosingPageProps = {
  searchParams: Promise<{
    activityPage?: string;
    message?: string;
    shiftPage?: string;
    type?: string;
    returnTo?: string;
    branchId?: string;
    date?: string;
  }>;
};

const ACTIVITY_PAGE_SIZE = 10;
const SHIFT_PAGE_SIZE = 10;

const paymentMethodLabels: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  FOREIGN_CURRENCY: "Foreign currency",
  CRYPTO: "Crypto asset",
  CARD: "Card",
  CASH: "Cash",
  DUITNOW: "DuitNow",
  EWALLET: "E-wallet",
  PACKAGE: "Package use",
};

export default async function ClosingPage({ searchParams }: ClosingPageProps) {
  const context = await requireBusinessContext({ capability: "RUN_CLOSING" });
  const params = await searchParams;
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const returnTo = normalizeCashierReturnTo(params.returnTo);
  const explicitDate =
    params.date && isValidDateValue(params.date) ? params.date : null;
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
  const businessTimeSettings = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      businessDayCutoffTime: true,
      timezone: true,
    },
  });
  const todayDateValue = getCurrentBusinessDateValue(
    new Date(),
    businessTimeSettings.timezone,
    businessTimeSettings.businessDayCutoffTime,
  );
  const closingIndustry = isDailyClosingIndustry(context.industryType)
    ? context.industryType
    : null;
  const isOwner = context.user.role === "BUSINESS_OWNER";
  const canConfirmDailyClosing = hasStaffPermission(
    context.user,
    "CONFIRM_DAILY_CLOSING",
  );
  const branches = await getOperationalBranches(businessId, context.user);
  const todayStart = getDailyClosingRange(
    undefined,
    todayDateValue,
    businessTimeSettings,
  ).fromDate;
  const authorizedBranchIds = branches.map((branch) => branch.id);
  const shiftInclude = {
    branch: true,
    cashier: {
      select: { name: true },
    },
    payments: {
      where: { status: "ACTIVE" as const },
      orderBy: { paidAt: "desc" as const },
    },
    refunds: {
      orderBy: { refundedAt: "desc" as const },
    },
    expensePayouts: {
      orderBy: { occurredAt: "desc" as const },
      select: {
        amount: true,
        id: true,
        occurredAt: true,
        paymentEvent: {
          select: {
            paymentReference: true,
            expense: {
              select: {
                expenseNumber: true,
                payeeName: true,
              },
            },
          },
        },
      },
    },
  };
  const [openShift, staleOpenShifts] = await Promise.all([
    prisma.cashierShift.findFirst({
      where: {
        businessId,
        cashierId: context.user.userId,
        status: "OPEN",
      },
      include: shiftInclude,
    }),
    prisma.cashierShift.findMany({
      where: {
        businessId,
        status: "OPEN",
        startedAt: { lt: todayStart },
        ...(canConfirmDailyClosing
          ? authorizedBranchIds.length
            ? { branchId: { in: authorizedBranchIds } }
            : {}
          : { cashierId: context.user.userId }),
      },
      include: shiftInclude,
      orderBy: { startedAt: "asc" },
      take: 5,
    }),
  ]);
  const staleShiftForDate = staleOpenShifts[0] ?? null;
  const requestedDate =
    explicitDate ??
    (staleShiftForDate
      ? getCurrentBusinessDateValue(
          staleShiftForDate.startedAt,
          businessTimeSettings.timezone,
          businessTimeSettings.businessDayCutoffTime,
        )
      : todayDateValue);
  const todayRange = getDailyClosingRange(
    undefined,
    requestedDate,
    businessTimeSettings,
  );
  const { dateValue, fromDate, toDateExclusive } = todayRange;
  const selectedBranch =
    branches.find((branch) => branch.id === params.branchId) ??
    (staleShiftForDate
      ? branches.find((branch) => branch.id === staleShiftForDate.branchId)
      : undefined) ??
    (openShift ? branches.find((branch) => branch.id === openShift.branchId) : undefined) ??
    branches[0] ??
    null;
  const shifts = await prisma.cashierShift.findMany({
    where: {
      businessId,
      ...(canConfirmDailyClosing && selectedBranch
        ? { branchId: selectedBranch.id }
        : { cashierId: context.user.userId }),
      OR: [
        { startedAt: { gte: fromDate, lt: toDateExclusive } },
        { endedAt: { gte: fromDate, lt: toDateExclusive } },
        { status: "OPEN" },
      ],
    },
    include: shiftInclude,
    orderBy: { startedAt: "desc" },
  });
  const relevantOpenShiftCount = selectedBranch
    ? await prisma.cashierShift.count({
        where: {
          branchId: selectedBranch.id,
          businessId,
          startedAt: { gte: fromDate, lt: toDateExclusive },
          status: "OPEN",
        },
      })
    : 0;
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
  const openShiftBusinessDate = openShift
    ? getCurrentBusinessDateValue(
        openShift.startedAt,
        businessTimeSettings.timezone,
        businessTimeSettings.businessDayCutoffTime,
      )
    : null;
  const openShiftCrossedCutoff = Boolean(
    openShiftBusinessDate && openShiftBusinessDate !== todayDateValue,
  );
  const [otherOpenShiftCount, openShiftSnapshot] = openShift?.branchId
    ? await Promise.all([
        prisma.cashierShift.count({
          where: {
            branchId: openShift.branchId,
            businessId,
            id: { not: openShift.id },
            status: "OPEN",
          },
        }),
        prisma.dailyClosingSnapshot.findUnique({
          where: {
            businessId_branchId_businessDate: {
              branchId: openShift.branchId,
              businessDate: normalizeBusinessDate(openShiftBusinessDate!),
              businessId,
            },
          },
          select: { id: true },
        }),
      ])
    : [0, null];
  const willCompleteDailyClosing =
    Boolean(openShift?.branchId) &&
    !openShiftCrossedCutoff &&
    otherOpenShiftCount === 0 &&
    !openShiftSnapshot;
  const isViewingOpenShiftBusinessDay =
    Boolean(openShift?.branchId) &&
    selectedBranch?.id === openShift?.branchId &&
    dateValue === openShiftBusinessDate;
  const snapshotPayload =
    existingSnapshot &&
    isDailyClosingSnapshotPayload(existingSnapshot.reportDataJson)
      ? existingSnapshot.reportDataJson
      : null;
  const displayTimeZone =
    snapshotPayload?.timezone ?? businessTimeSettings.timezone;
  const snapshotBusinessDayCutoffTime = snapshotPayload
    ? getSnapshotBusinessDayCutoffTime(snapshotPayload)
    : businessTimeSettings.businessDayCutoffTime;
  const snapshotRange = snapshotPayload
    ? getDailyClosingRange(undefined, snapshotPayload.businessDate, {
        businessDayCutoffTime: snapshotBusinessDayCutoffTime,
        timezone: snapshotPayload.timezone,
      })
    : todayRange;
  const dailyClosing = selectedBranch && closingIndustry
    ? snapshotPayload
      ? {
          branchId: snapshotPayload.branch.id,
          branchName: snapshotPayload.branch.name,
          businessName: snapshotPayload.business.name,
          dateValue: snapshotPayload.businessDate,
          fromDate: snapshotRange.fromDate,
          generatedAt: new Date(snapshotPayload.generatedAt),
          generatedAtLabel: formatSnapshotDateTime(
            new Date(snapshotPayload.generatedAt),
            displayTimeZone,
          ),
          industry: closingIndustry,
          preview: existingSnapshot?.whatsappText ?? "",
          report: snapshotPayload.report,
          timeZone: snapshotPayload.timezone,
          businessDayCutoffTime: snapshotBusinessDayCutoffTime,
          toDateExclusive: snapshotRange.toDateExclusive,
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
  const currentShiftExpensePayoutCents = openShift
    ? openShift.expensePayouts.reduce(
        (total, payout) => total + toCents(payout.amount),
        0,
      )
    : 0;
  const currentShiftNetCashMovementCents =
    toCents(currentShiftSummary?.cashAmount ?? 0) -
    currentShiftExpensePayoutCents;
  const currentShiftExpectedCashCents = openShift
    ? toCents(openShift.openingFloat) + currentShiftNetCashMovementCents
    : 0;
  const allActivities = buildShiftActivities(
    canConfirmDailyClosing ? shifts : openShift ? [openShift] : shifts,
  );
  const lateActivity = existingSnapshot
    ? summarizeLateActivity(
        allActivities.filter((activity) => activity.occurredAt > existingSnapshot.closedAt),
        displayTimeZone,
      )
    : null;
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
            <small>Closes at {businessTimeSettings.businessDayCutoffTime} · {businessTimeSettings.timezone}</small>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}
        {staleOpenShifts.length > 0 ? (
          <div className="warning closing-stale-shift-notice" role="alert">
            <div className="closing-stale-shift-copy">
              <strong>Previous business-day shift still open</strong>
              <span>
                This shift has crossed the business-day cutoff. Close it before processing
                new sales, refunds or drawer expenses. This page shows its original business date.
              </span>
            </div>
            <div className="closing-stale-shift-list">
              {staleOpenShifts.map((shift) => {
                const shiftDateValue = getCurrentBusinessDateValue(
                  shift.startedAt,
                  businessTimeSettings.timezone,
                  businessTimeSettings.businessDayCutoffTime,
                );
                const summary = summarizePayments(shift.payments, shift.refunds);
                const expenses = shift.expensePayouts.reduce((total, payout) => total + toCents(payout.amount), 0);
                const expected = toCents(shift.openingFloat) + toCents(summary.cashAmount) - expenses;
                return canConfirmDailyClosing ? (
                  <form action={resolveStaleShiftAction} className="closing-stale-resolution" key={shift.id}>
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <div>
                      <strong>{shift.cashier.name} · {shift.branch?.name ?? "Branch"}</strong>
                      <span>{formatBusinessDate(shiftDateValue)} · Expected Drawer Cash {formatMoneyFromCents(expected)}</span>
                    </div>
                    <label><span>Counted Cash</span><input name="countedCash" type="number" min="0" max="21474836.47" step="0.01" required /></label>
                    <label><span>Reason</span><input name="reason" maxLength={1000} required /></label>
                    <button type="submit">Resolve stale shift</button>
                  </form>
                ) : (
                  <Link className="secondary-link-button" href={makeClosingHref(params, { activityPage: 1, branchId: shift.branchId ?? undefined, date: shiftDateValue, shiftPage: 1 })} key={shift.id}>
                    {shift.branch?.name ?? "Branch"} · {formatBusinessDate(shiftDateValue)}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

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
                  <Metric
                    label="Started"
                    value={formatDateTime(openShift.startedAt, displayTimeZone)}
                  />
                  <Metric label="Opening Float" value={money(openShift.openingFloat)} />
                  <Metric
                    label="Net Cash Sales"
                    value={money(currentShiftSummary?.cashAmount ?? 0)}
                  />
                  <Metric
                    label="POS Drawer Expenses"
                    value={formatMoneyFromCents(-currentShiftExpensePayoutCents)}
                  />
                  <Metric
                    label="Net Cash Movement"
                    value={formatMoneyFromCents(currentShiftNetCashMovementCents)}
                  />
                  <Metric
                    label="Expected Drawer Cash"
                    value={formatMoneyFromCents(currentShiftExpectedCashCents)}
                  />
                </div>
                <form action={endShiftAction} className="form closing-form closing-end-form">
                  <input type="hidden" name="shiftId" value={openShift.id} />
                  <div className="field-grid closing-field-grid">
                    <label>
                      <span>Counted Cash</span>
                      <input
                        inputMode="decimal"
                        min="0"
                        max="21474836.47"
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
                  <div
                    className={`closing-shift-completion-note ${
                      willCompleteDailyClosing
                        ? "closing-shift-completion-note-final"
                        : ""
                    }`}
                  >
                    <strong>
                      {openShiftCrossedCutoff
                        ? "Cutoff crossed — close this shift now"
                        : willCompleteDailyClosing
                        ? "Final open shift for this branch"
                        : otherOpenShiftCount > 0
                          ? `${otherOpenShiftCount} other open ${
                              otherOpenShiftCount === 1 ? "shift" : "shifts"
                            }`
                          : "Daily closing already completed"}
                    </strong>
                    <span>
                      {openShiftCrossedCutoff
                        ? "New POS activity is blocked. Ending this shift will not freeze a wrong-date daily snapshot."
                        : willCompleteDailyClosing
                        ? "Ending this shift will also freeze today's daily closing report."
                        : otherOpenShiftCount > 0
                          ? "This shift will end now. Daily closing completes when the final shift ends."
                          : "Ending this shift will not create another daily closing report."}
                    </span>
                  </div>
                  <div className="form-actions closing-form-actions">
                    <button type="submit">End shift</button>
                  </div>
                </form>
              </div>
            ) : (
              <form action={startShiftAction} className="form closing-form">
                {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
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
                        <span>Opening Float</span>
                        <input
                          defaultValue="0.00"
                          inputMode="decimal"
                          min="0"
                          max="21474836.47"
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

          {currentShiftSummary ? (
            <ReportCard title="Current Shift Totals" className="closing-total-card">
              <div className="report-kpis compact-kpis closing-total-kpis">
                <Metric
                  label="Gross Collected"
                  value={money(currentShiftSummary.grossCollected)}
                />
                <Metric label="Refunds" value={money(currentShiftSummary.refunded)} />
                <Metric label="Net Collected" value={money(currentShiftSummary.collected)} />
                <Metric label="Payments" value={currentShiftSummary.paymentCount} />
                <Metric label="Net Cash" value={money(currentShiftSummary.cashAmount)} />
                <Metric
                  label="POS Drawer Expenses"
                  value={formatMoneyFromCents(-currentShiftExpensePayoutCents)}
                />
                <Metric
                  label="Net Cash Movement"
                  value={formatMoneyFromCents(currentShiftNetCashMovementCents)}
                />
                <Metric label="Package Uses" value={`${currentShiftSummary.packageUses} uses`} />
              </div>
            </ReportCard>
          ) : null}
        </section>

        {canConfirmDailyClosing && dailyClosing ? (
          <>
            <DailyClosingSummary
              dailyClosing={dailyClosing}
              branches={branches}
              returnTo={returnTo}
              isFrozen={Boolean(existingSnapshot)}
            />
            {isViewingOpenShiftBusinessDay && !existingSnapshot ? (
              <div className="panel daily-closing-auto-panel">
                <div>
                  <span className="eyebrow">DAILY CLOSE</span>
                  <h2>Daily Closing not ready</h2>
                  <p>
                    {openShiftCrossedCutoff
                      ? "This cashier shift crossed the business-day cutoff. Close it now; the system will fail closed instead of freezing a wrong-date report."
                      : `${otherOpenShiftCount + 1} cashier ${otherOpenShiftCount === 0 ? "shift is" : "shifts are"} still open. Close all shifts for this branch first.`}
                  </p>
                </div>
                <span className="status warning">
                  {openShiftCrossedCutoff
                    ? "Review required"
                    : `${otherOpenShiftCount + 1} ${otherOpenShiftCount === 0 ? "shift" : "shifts"} open`}
                </span>
              </div>
            ) : (
              <DailyClosingSnapshotPanel
              branchId={dailyClosing.branchId}
              branchName={dailyClosing.branchName}
              businessDate={dailyClosing.dateValue}
              openShiftCount={relevantOpenShiftCount}
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
                        displayTimeZone,
                      ),
                      closedByName:
                        existingSnapshot.closedBy.name ||
                        snapshotPayload.closedBy.name,
                      closingNote: snapshotPayload.closingNote,
                      expectedCashCents: snapshotPayload.cash.expectedCents,
                      whatsappSends: existingSnapshot.closingWhatsAppSends.map(
                        (send) => ({
                          completedAtLabel: send.completedAt
                            ? formatSnapshotDateTime(
                                send.completedAt,
                                displayTimeZone,
                              )
                            : null,
                          errorMessage: send.errorMessage,
                          id: send.id,
                          phone: send.phone,
                          reason: send.reason,
                          recipientLabel: send.recipient?.label ?? send.phone,
                          recipientRole: send.recipient?.role ?? null,
                          requestedAtLabel: formatSnapshotDateTime(
                            send.requestedAt,
                            displayTimeZone,
                          ),
                          requestedByName: send.requestedBy?.name ?? null,
                          sendType: send.sendType,
                          status: send.status,
                          trigger: send.trigger,
                        }),
                      ),
                    }
                  : null
              }
              lateActivity={lateActivity}
              />
            )}
          </>
        ) : canConfirmDailyClosing && existingSnapshot ? (
          <div className="panel daily-closing-empty error">
            <h2>Frozen report cannot be displayed</h2>
            <p>
              This closing snapshot has an unsupported report format. Its stored
              data was not recalculated or replaced.
            </p>
          </div>
        ) : canConfirmDailyClosing ? (
          <div className="panel daily-closing-empty">
            <h2>Daily Closing Report</h2>
            <p className="empty-state">
              Assign this account to an active branch to view today&apos;s business summary.
            </p>
          </div>
        ) : null}

        <section className="report-grid closing-activity-grid">
          <ReportCard
            title={
              canConfirmDailyClosing
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
                      <th>Drawer Expenses</th>
                      <th>Expected Cash</th>
                      <th>Counted</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShifts.map((shift) => {
                      const summary = summarizePayments(shift.payments, shift.refunds);
                      const expensePayoutAmount = sumMoneyAmounts(
                        shift.expensePayouts.map((payout) => payout.amount),
                      );
                      const expectedCash =
                        shift.expectedCash ??
                        sumMoneyAmounts([
                          shift.openingFloat,
                          summary.cashAmount,
                          -expensePayoutAmount,
                        ]);

                      return (
                        <tr key={shift.id}>
                          <td>{shift.cashier.name}</td>
                          <td>{shift.branch?.name ?? "All branches"}</td>
                          <td>{formatStatus(shift.status)}</td>
                          <td>{formatDateTime(shift.startedAt, displayTimeZone)}</td>
                          <td>
                            {shift.endedAt
                              ? formatDateTime(shift.endedAt, displayTimeZone)
                              : "-"}
                          </td>
                          <td>{money(summary.grossCollected)}</td>
                          <td>{money(summary.refunded)}</td>
                          <td>{money(summary.collected)}</td>
                          <td>{formatMoneyFromCents(-toCents(expensePayoutAmount))}</td>
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
                        <td>
                          {formatTime(activity.occurredAt, displayTimeZone)}
                        </td>
                        <td>{paymentMethodLabels[activity.method]}</td>
                        <td>
                          {activity.method === "PACKAGE"
                            ? `${activity.packageUses} use${activity.packageUses === 1 ? "" : "s"}`
                            : activity.type === "refund"
                              ? `-${money(activity.amount)}`
                              : activity.type === "expense"
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
              <p className="empty-state">
                No payment, refund, or POS drawer expense records for this shift.
              </p>
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

function normalizeCashierReturnTo(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost" || url.pathname !== "/cashier") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function makeClosingHref(
  params: Awaited<ClosingPageProps["searchParams"]>,
  pages: {
    activityPage?: number;
    branchId?: string;
    date?: string;
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
  const branchId = pages.branchId ?? params.branchId;
  const date = pages.date ?? params.date;
  if (branchId) query.set("branchId", branchId);
  if (date) query.set("date", date);
  if (params.returnTo) query.set("returnTo", params.returnTo);
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
  type: "expense" | "payment" | "refund";
};

function summarizeLateActivity(activities: ShiftActivity[], timeZone: string) {
  if (!activities.length) return null;
  const ordered = [...activities].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
  const netCashMovementCents = ordered.reduce((total, activity) => {
    if (activity.method !== "CASH") return total;
    const amountCents = Math.round(activity.amount * 100);
    return activity.type === "payment" ? total + amountCents : total - amountCents;
  }, 0);
  return {
    count: ordered.length,
    firstAtLabel: formatDateTime(ordered[0].occurredAt, timeZone),
    latestAtLabel: formatDateTime(ordered[ordered.length - 1].occurredAt, timeZone),
    netCashMovementCents,
  };
}

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
    expensePayouts: {
      amount: unknown;
      id: string;
      occurredAt: Date;
      paymentEvent: {
        paymentReference: string | null;
        expense: {
          expenseNumber: string;
          payeeName: string | null;
        };
      };
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

    for (const payout of shift.expensePayouts) {
      activities.push({
        amount: Number(payout.amount ?? 0),
        detail: payout.paymentEvent.expense.payeeName
          ? `${payout.paymentEvent.expense.expenseNumber} · ${payout.paymentEvent.expense.payeeName}`
          : payout.paymentEvent.expense.expenseNumber,
        id: `expense-${payout.id}`,
        method: "CASH",
        occurredAt: payout.occurredAt,
        packageUses: 0,
        reference: payout.paymentEvent.paymentReference,
        status: "expense payout",
        type: "expense",
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

function formatDateTime(value: Date, timeZone: string) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone,
  });
}

function formatTime(value: Date, timeZone: string) {
  return value.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function formatBusinessDate(dateValue: string) {
  return formatDateValue(dateValue, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSnapshotDateTime(value: Date, timeZone: string) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  });
}

type DailyClosingResult = Awaited<ReturnType<typeof getDailyClosingReport>>;

function DailyClosingSummary({
  dailyClosing,
  branches,
  isFrozen,
  returnTo,
}: {
  dailyClosing: DailyClosingResult;
  branches: Awaited<ReturnType<typeof getOperationalBranches>>;
  isFrozen: boolean;
  returnTo: string | null;
}) {
  const report = dailyClosing.report;
  const operationUnit =
    dailyClosing.industry === "AUTO_DETAILING" ? "Work orders" : "Appointments";

  return (
    <section className="panel daily-closing-report" aria-labelledby="daily-closing-title">
      <div className="daily-closing-header">
        <div>
          <span className="daily-closing-eyebrow">BRANCH CLOSING STATUS</span>
          <h2 id="daily-closing-title">{dailyClosing.branchName}</h2>
          <p>
            {formatBusinessDate(dailyClosing.dateValue)} · closes at {dailyClosing.businessDayCutoffTime} ·{" "}
            {isFrozen ? "Final figures from the frozen snapshot" : "Preview before daily closing"}
          </p>
        </div>
        <form method="get" className="daily-closing-branch-form">
          {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          <input type="hidden" name="date" value={dailyClosing.dateValue} />
          <label>
            <span>Branch View</span>
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

      <div className="daily-closing-owner-view">
        <section className="daily-closing-owner-totals" aria-label="Closing totals">
          <ClosingMetric
            label="Net sales"
            value={formatMoneyFromCents(report.financial.netSalesCents)}
            emphasis
          />
          <ClosingMetric
            label="Net collections"
            value={formatMoneyFromCents(report.financial.collectedCents)}
          />
          <ClosingMetric
            label="Outstanding"
            value={formatMoneyFromCents(report.financial.outstandingCents)}
          />
        </section>
      </div>

      <details className="daily-closing-preview daily-closing-whatsapp-preview">
        <summary>
          <span><strong>WhatsApp Closing Report</strong><small>{isFrozen ? "Frozen message" : "Preview"}</small></span>
          <span>Preview</span>
        </summary>
        <pre>{dailyClosing.preview}</pre>
      </details>

      <details className="daily-closing-details">
        <summary>
          <span>
            <strong>View full report details</strong>
            <small>Payments, operations, services, packages and alerts</small>
          </span>
          <span className="daily-closing-details-action">Expand</span>
        </summary>
        <div className="daily-closing-details-content">
      <div className="daily-closing-kpis">
        <ClosingMetric label="Gross sales" value={formatMoneyFromCents(report.financial.grossSalesCents)} />
        <ClosingMetric label="Net collections" value={formatMoneyFromCents(report.financial.collectedCents)} />
        <ClosingMetric label="Outstanding" value={formatMoneyFromCents(report.financial.outstandingCents)} />
        <ClosingMetric label="Discounts" value={formatMoneyFromCents(report.financial.discountsCents)} />
        <ClosingMetric label="Refunds" value={formatMoneyFromCents(report.financial.refundsCents)} />
        <ClosingMetric label="POS drawer expense payouts" value={formatMoneyFromCents(report.cashDrawer.expensePayoutCents)} />
        <ClosingMetric label="Net sales" value={formatMoneyFromCents(report.financial.netSalesCents)} emphasis />
      </div>

      <div className="daily-closing-columns">
        <section className="daily-closing-section">
          <div className="daily-closing-section-heading">
            <div>
              <h3>Payment breakdown</h3>
              <p>Actual active payments less refunds. POS drawer expense payouts are shown separately and reduce expected cash.</p>
            </div>
          </div>
          <div className="daily-closing-table-wrap">
            <table className="table compact-table daily-closing-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Gross collected</th>
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
        <section className="daily-closing-section daily-closing-alert-section">
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

      </div>
        </div>
      </details>

      <footer className="daily-closing-footer">
        <span>
          Generated {dailyClosing.generatedAtLabel} | {dailyClosing.businessName}
        </span>
        <span>
          Scope: {dailyClosing.branchName} · {formatBusinessDate(dailyClosing.dateValue)} business day · cutoff {dailyClosing.businessDayCutoffTime}
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
    FOREIGN_CURRENCY: "Foreign currency",
    CRYPTO: "Crypto asset",
  };
  return labels[method] ?? method;
}

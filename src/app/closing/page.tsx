import Link from "next/link";
import type { PaymentMethod, PaymentRecordStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { endShiftAction, startShiftAction } from "./actions";

type ClosingPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

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

  if (!context.businessId) {
    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
            <Link href="/login">Back to login</Link>
          </div>
        </section>
      </AppShell>
    );
  }

  const businessId = context.businessId;
  const { fromDate, toDateExclusive } = getTodayRange();
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
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const currentShiftSummary = openShift ? summarizePayments(openShift.payments) : null;
  const visiblePayments = openShift
    ? openShift.payments
    : shifts.flatMap((shift) => shift.payments).slice(0, 80);
  const canStartShift = isOwner || branches.length > 0;

  return (
    <AppShell user={context.user}>
      <section className="content report-content closing-content">
        <div className="page-header report-header">
          <div>
            <h1>Shift Closing</h1>
            <p>Cashier shift closing for {formatDisplayDate(fromDate)}.</p>
          </div>
          <div className="report-period">
            <span>Today</span>
            <strong>
              {formatDisplayDate(fromDate)} - {formatDisplayDate(addDays(toDateExclusive, -1))}
            </strong>
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
                    label="Cash Sales"
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
                          <select name="branchId" defaultValue="" required>
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
                <Metric label="Collected" value={money(currentShiftSummary.collected)} />
                <Metric label="Payments" value={currentShiftSummary.paymentCount} />
                <Metric label="Cash" value={money(currentShiftSummary.cashAmount)} />
                <Metric label="Package Uses" value={`${currentShiftSummary.packageUses} uses`} />
              </div>
            ) : (
              <p className="empty-state">Start a shift to begin closing tracking.</p>
            )}
          </ReportCard>
        </section>

        <section className="report-grid">
          <ReportCard title={isOwner ? "Today's Shifts" : "My Shifts"} className="closing-table-card">
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
                      <th>Collected</th>
                      <th>Expected Cash</th>
                      <th>Counted</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((shift) => {
                      const summary = summarizePayments(shift.payments);
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
          </ReportCard>

          <ReportCard
            title={openShift ? "Current Shift Payments" : "Recent Shift Payments"}
            className="closing-table-card"
          >
            {visiblePayments.length ? (
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
                    {visiblePayments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{formatTime(payment.paidAt)}</td>
                        <td>{paymentMethodLabels[payment.method]}</td>
                        <td>
                          {payment.method === "PACKAGE"
                            ? `${payment.packageUses} use`
                            : money(payment.amount)}
                        </td>
                        <td>{formatPaymentStatus(payment.status)}</td>
                        <td>{payment.reference || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">No payment records for this shift.</p>
            )}
          </ReportCard>
        </section>
      </section>
    </AppShell>
  );
}

function summarizePayments(
  payments: {
    amount: unknown;
    method: PaymentMethod;
    packageUses: number;
  }[],
) {
  return payments.reduce(
    (summary, payment) => {
      if (payment.method === "PACKAGE") {
        summary.packageUses += payment.packageUses;
      } else {
        summary.collected += Number(payment.amount ?? 0);
        summary.paymentCount += 1;
      }

      if (payment.method === "CASH") {
        summary.cashAmount += Number(payment.amount ?? 0);
      }

      return summary;
    },
    {
      cashAmount: 0,
      collected: 0,
      packageUses: 0,
      paymentCount: 0,
    },
  );
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

function getTodayRange() {
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toDateExclusive = addDays(fromDate, 1);

  return { fromDate, toDateExclusive };
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
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

function formatDisplayDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function formatTime(value: Date) {
  return value.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

import {
  StaffV2CompactSummary,
  StaffV2DetailSection,
  StaffV2EmptyState,
  StaffV2PageHeader,
  StaffV2PeriodNavigator,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import {
  adjustmentTypeLabel,
  commissionStatusPresentation,
  employeeSafeAdjustmentReason,
  formatCommissionDate,
  formatCommissionDayMonth,
  formatCommissionMoney,
  formatCommissionPeriod,
  formatSignedCommissionMoney,
  sourceTypeLabel,
  type StaffCommissionAdjustmentType,
  type StaffCommissionSourceType,
  type StaffCommissionStatus,
} from "@/lib/staff-pwa/commission-v2";
import styles from "./staff-commission-v2.module.css";

type CommissionStatement = Readonly<{
  id: string;
  status: StaffCommissionStatus;
  eligibleSalesCents: number;
  calculatedCommissionCents: number;
  adjustmentCents: number;
  finalCommissionCents: number;
  period: Readonly<{
    id: string;
    earnedPeriodStart: Date;
    earnedPeriodEnd: Date;
  }>;
  accruals: ReadonlyArray<Readonly<{
    status: "ACTIVE" | "REVERSED";
    eligibleAmountCents: number;
    commissionAmountCents: number;
    sourceEvent: Readonly<{
      sourceType: StaffCommissionSourceType;
      businessDate: Date;
      grossAmountCents: number;
      netAmountCents: number;
    }>;
  }>>;
  appliedAdjustments: ReadonlyArray<Readonly<{
    type: StaffCommissionAdjustmentType;
    eligibleAmountCents: number;
    commissionAmountCents: number;
    reason: string;
  }>>;
}>;

export function StaffCommissionV2({ statements, selectedIndex }: {
  statements: ReadonlyArray<CommissionStatement>;
  selectedIndex: number;
}) {
  const statement = statements[selectedIndex] ?? statements[0];

  return (
    <section aria-label="Commission" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Commission" meta="Your commission statements." />

      {!statement ? (
        <StaffV2EmptyState
          title="No commission statement yet."
          description="Your commission statements will appear here when available."
        />
      ) : (
        <>
          <StaffV2PeriodNavigator
            ariaLabel="Commission earning period"
            label={formatCommissionPeriod(statement.period.earnedPeriodStart, statement.period.earnedPeriodEnd)}
            previousHref={periodHref(statements[selectedIndex + 1]?.period.id)}
            previousLabel={statements[selectedIndex + 1] ? "Previous commission period" : "Previous commission period unavailable"}
            nextHref={periodHref(statements[selectedIndex - 1]?.period.id)}
            nextLabel={statements[selectedIndex - 1] ? "Next commission period" : "Next commission period unavailable"}
          />

          <section aria-labelledby="staff-commission-current-heading" className={styles.statementSummary}>
            <header className={styles.summaryHeader}>
              <div>
                <StaffV2SectionLabel id="staff-commission-current-heading">Current statement</StaffV2SectionLabel>
                <span className={styles.totalLabel}>Total commission</span>
                <strong className={styles.total}>{formatCommissionMoney(statement.finalCommissionCents)}</strong>
              </div>
              <CommissionStatusBadge status={statement.status} />
            </header>
            <StaffV2CompactSummary items={[
              { label: "Eligible sales", value: formatCommissionMoney(statement.eligibleSalesCents) },
              { label: "Calculated commission", value: formatCommissionMoney(statement.calculatedCommissionCents) },
              ...(statement.adjustmentCents !== 0
                ? [{ label: "Adjustments", value: formatSignedCommissionMoney(statement.adjustmentCents) }]
                : []),
            ]} />
          </section>

          <section aria-labelledby="staff-commission-breakdown-heading" className={styles.section}>
            <StaffV2SectionLabel id="staff-commission-breakdown-heading">Breakdown</StaffV2SectionLabel>
            {statement.accruals.length ? (
              <StaffV2RowGroup ariaLabel="Commission breakdown" className={styles.rowGroup}>
                {statement.accruals.map((accrual, index) => (
                  <details className={styles.line} key={`${accrual.sourceEvent.businessDate.toISOString()}-${index}`} role="listitem">
                    <summary aria-label={`${sourceTypeLabel(accrual.sourceEvent.sourceType)} on ${formatCommissionDate(accrual.sourceEvent.businessDate)}, commission ${formatCommissionMoney(accrual.commissionAmountCents)}`} className={styles.lineSummary}>
                      <span className={styles.date}>{formatCommissionDayMonth(accrual.sourceEvent.businessDate)}</span>
                      <span className={styles.lineCopy}>
                        <strong>{sourceTypeLabel(accrual.sourceEvent.sourceType)}</strong>
                        <small>Eligible {formatCommissionMoney(accrual.eligibleAmountCents)}</small>
                      </span>
                      <span className={styles.lineAmount}>
                        <small>Commission</small>
                        <strong>{formatCommissionMoney(accrual.commissionAmountCents)}</strong>
                      </span>
                      <span aria-hidden="true" className={styles.chevron}>›</span>
                    </summary>
                    <div className={styles.detail}>
                      <StaffV2DetailSection title="Line details">
                        <dl className={styles.detailList}>
                          <Detail label="Date" value={formatCommissionDate(accrual.sourceEvent.businessDate)} />
                          <Detail label="Source" value={sourceTypeLabel(accrual.sourceEvent.sourceType)} />
                          <Detail label="Gross amount" value={formatCommissionMoney(accrual.sourceEvent.grossAmountCents)} />
                          <Detail label="Net amount" value={formatCommissionMoney(accrual.sourceEvent.netAmountCents)} />
                          <Detail label="Eligible amount" value={formatCommissionMoney(accrual.eligibleAmountCents)} />
                          <Detail label="Commission" value={formatCommissionMoney(accrual.commissionAmountCents)} />
                        </dl>
                      </StaffV2DetailSection>
                    </div>
                  </details>
                ))}
              </StaffV2RowGroup>
            ) : (
              <StaffV2EmptyState
                title="No commission lines for this period."
                description="The valid statement total and status remain available above."
              />
            )}
          </section>

          {statement.adjustmentCents !== 0 ? (
            <section aria-labelledby="staff-commission-adjustments-heading" className={styles.section}>
              <StaffV2SectionLabel id="staff-commission-adjustments-heading">Adjustments</StaffV2SectionLabel>
              <StaffV2RowGroup ariaLabel="Commission adjustments" className={styles.rowGroup}>
                {statement.appliedAdjustments.length ? statement.appliedAdjustments.map((adjustment, index) => (
                  <div className={styles.adjustmentRow} key={`${adjustment.type}-${index}`} role="listitem">
                    <span className={styles.lineCopy}>
                      <strong>{adjustmentTypeLabel(adjustment.type)}</strong>
                      <small>{employeeSafeAdjustmentReason(adjustment.type, adjustment.reason)}</small>
                    </span>
                    <strong className={styles.adjustmentAmount}>{formatSignedCommissionMoney(adjustment.commissionAmountCents)}</strong>
                  </div>
                )) : (
                  <div className={styles.adjustmentRow} role="listitem">
                    <span className={styles.lineCopy}>
                      <strong>Statement adjustment</strong>
                      <small>Included in this statement total.</small>
                    </span>
                    <strong className={styles.adjustmentAmount}>{formatSignedCommissionMoney(statement.adjustmentCents)}</strong>
                  </div>
                )}
              </StaffV2RowGroup>
            </section>
          ) : null}

          <p className={styles.footerNote}>Payroll linkage does not prove payslip publication or salary settlement.</p>
        </>
      )}
    </section>
  );
}

function CommissionStatusBadge({ status }: { status: StaffCommissionStatus }) {
  const presentation = commissionStatusPresentation(status);
  return <StaffV2StatusBadge tone={presentation.tone}>{presentation.label}</StaffV2StatusBadge>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function periodHref(periodId?: string) {
  return periodId ? `/staff/commission?period=${encodeURIComponent(periodId)}` : null;
}

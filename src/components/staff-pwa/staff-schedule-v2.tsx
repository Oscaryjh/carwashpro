import {
  StaffV2DetailSection,
  StaffV2EmptyState,
  StaffV2PageHeader,
  StaffV2PeriodNavigator,
  StaffV2RowGroup,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import type {
  StaffScheduleV2Day,
  StaffScheduleV2Week,
} from "@/lib/staff-pwa/schedule-v2";
import styles from "./staff-schedule-v2.module.css";

export function StaffScheduleV2({
  week,
  hasWeekFacts,
  periodLabel,
  previousHref,
  previousLabel,
  nextHref,
  nextLabel,
  todayHref,
  todayLabel,
}: {
  week: StaffScheduleV2Week;
  hasWeekFacts: boolean;
  periodLabel: string;
  previousHref: string;
  previousLabel: string;
  nextHref: string;
  nextLabel: string;
  todayHref?: string;
  todayLabel?: string;
}) {
  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`} aria-label="Schedule">
      <StaffV2PageHeader
        title="Schedule"
        meta="Your expected work and approved time away."
      />

      <StaffV2PeriodNavigator
        label={periodLabel}
        previousHref={previousHref}
        previousLabel={previousLabel}
        nextHref={nextHref}
        nextLabel={nextLabel}
        todayHref={todayHref}
        todayLabel={todayLabel}
      />

      {hasWeekFacts ? (
        <StaffV2RowGroup ariaLabel={`Schedule for ${periodLabel}`} className={styles.weekGroup}>
          {week.days.map((day) => <ScheduleDayRow day={day} key={day.key} />)}
        </StaffV2RowGroup>
      ) : (
        <StaffV2EmptyState
          title="No schedule this week"
          description="Published shifts and approved time away will appear here."
        />
      )}

      <p className={styles.infoFooter}>
        Schedule shows expected work. Attendance shows what you actually worked.
      </p>
    </section>
  );
}

function ScheduleDayRow({ day }: { day: StaffScheduleV2Day }) {
  if (!day.expandable) {
    return (
      <div
        aria-current={day.isToday ? "date" : undefined}
        aria-label={day.ariaLabel}
        className={`${styles.dayRow} ${styles.simpleRow} ${day.isToday ? styles.todayRow : ""}`}
        role="listitem"
      >
        <DayRowContent day={day} />
      </div>
    );
  }

  return (
    <details
      className={`${styles.dayRow} ${day.isToday ? styles.todayRow : ""}`}
      role="listitem"
    >
      <summary
        aria-current={day.isToday ? "date" : undefined}
        aria-label={day.ariaLabel}
      >
        <DayRowContent day={day} />
        <span aria-hidden="true" className={styles.chevron}>›</span>
      </summary>
      <ScheduleDayDetail day={day} />
    </details>
  );
}

function DayRowContent({ day }: { day: StaffScheduleV2Day }) {
  return (
    <>
      <time className={styles.dateCell} dateTime={day.key}>
        <span>{day.weekday}</span>
        <strong>{day.dayNumber}</strong>
        {day.isToday ? <em>Today</em> : null}
      </time>
      <span className={styles.rowCopy}>
        <strong>{day.primary}</strong>
        {day.secondary.map((line) => <span key={line}>{line}</span>)}
      </span>
    </>
  );
}

function ScheduleDayDetail({ day }: { day: StaffScheduleV2Day }) {
  return (
    <div className={styles.detail}>
      <div className={styles.detailHeading}>
        <strong>{day.dateLabel}</strong>
        <StaffV2StatusBadge tone={statusTone(day.status)}>{statusLabel(day.status)}</StaffV2StatusBadge>
      </div>

      {day.shifts.map((shift, index) => (
        <StaffV2DetailSection
          key={shift.id}
          title={day.shifts.length > 1 ? `Shift ${index + 1} · ${shift.label}` : shift.label}
        >
          <p className={styles.detailTime}>{shift.timeLabel}</p>
          {shift.overnight && shift.startsLabel && shift.endsLabel ? (
            <dl className={styles.boundaryList}>
              <div><dt>Starts</dt><dd>{shift.startsLabel}</dd></div>
              <div><dt>Ends</dt><dd>{shift.endsLabel}</dd></div>
            </dl>
          ) : null}
          <dl className={styles.factList}>
            <div><dt>Branch</dt><dd>{shift.branchName}</dd></div>
            <div><dt>Break</dt><dd>{shift.breakLabel}</dd></div>
            <div><dt>Expected work</dt><dd>{shift.expectedWorkingTime}</dd></div>
          </dl>
        </StaffV2DetailSection>
      ))}

      {day.holidayLabel ? (
        <StaffV2DetailSection title="Public Holiday">
          <p className={styles.detailEvidence}>{day.holidayLabel}</p>
        </StaffV2DetailSection>
      ) : null}
    </div>
  );
}

function statusLabel(status: StaffScheduleV2Day["status"]) {
  if (status === "SHIFT") return "Scheduled";
  if (status === "APPROVED_LEAVE") return "Approved leave";
  if (status === "PUBLIC_HOLIDAY") return "Public Holiday";
  if (status === "REST_DAY") return "Rest day";
  return "No schedule";
}

function statusTone(status: StaffScheduleV2Day["status"]): "neutral" | "success" | "info" {
  if (status === "APPROVED_LEAVE") return "success";
  if (status === "PUBLIC_HOLIDAY") return "info";
  return "neutral";
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EmployeeCorrectionArchiveItem,
  EmployeeCorrectionArchivePage,
} from "@/lib/attendance/employee-correction-archive";
import {
  appendEmployeeCorrectionArchiveItems,
  auditEmployeeCorrectionActionRoute,
  getEmployeeCorrectionFinalResultCopy,
  getEmployeeCorrectionStatusPresentation,
  getEmployeeCorrectionTypeCopy,
} from "@/lib/staff-pwa/attendance-corrections-v2";
import {
  isEmployeeSessionError,
  staffApiFetch,
  StaffApiError,
} from "@/lib/staff-pwa/client";
import {
  StaffV2DetailSection,
  StaffV2EmptyState,
  StaffV2PageHeader,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  staffV2Styles,
} from "./staff-v2-primitives";
import styles from "./staff-attendance-corrections-v2.module.css";

const PAGE_SIZE = 20;

type ArchiveResponse = Readonly<{
  ok: true;
  data: EmployeeCorrectionArchivePage;
}>;

export function StaffAttendanceCorrectionsV2() {
  const router = useRouter();
  const [items, setItems] = useState<readonly EmployeeCorrectionArchiveItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  const handleLoadFailure = useCallback((caught: unknown) => {
    if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
      router.replace("/staff/login?reason=session-expired");
      return true;
    }
    return false;
  }, [router]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await staffApiFetch<ArchiveResponse>(
        `/api/employee-attendance/corrections?limit=${PAGE_SIZE}`,
      );
      setItems(response.data.items);
      setNextCursor(response.data.nextCursor);
      setHasMore(response.data.hasMore);
    } catch (caught) {
      if (!handleLoadFailure(caught)) setError(true);
    } finally {
      setLoading(false);
    }
  }, [handleLoadFailure]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  async function loadMore() {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        cursor: nextCursor,
      });
      const response = await staffApiFetch<ArchiveResponse>(
        `/api/employee-attendance/corrections?${params.toString()}`,
      );
      setItems((current) => appendEmployeeCorrectionArchiveItems(current, response.data.items));
      setNextCursor(response.data.nextCursor);
      setHasMore(response.data.hasMore);
    } catch (caught) {
      if (!handleLoadFailure(caught)) setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const hasMultipleBranches = useMemo(
    () => new Set(items.map((item) => item.branchId)).size > 1,
    [items],
  );

  return (
    <section
      aria-label="Attendance corrections"
      className={`${staffV2Styles.scope} ${styles.page}`}
    >
      <StaffV2PageHeader
        title="Attendance corrections"
        meta="Track attendance corrections you've submitted."
      />

      <Link className={styles.historyLink} href="/staff/history/records">
        <span>
          <strong>Attendance history</strong>
          <small>View punches or report another attendance issue</small>
        </span>
        <i aria-hidden="true">›</i>
      </Link>

      <section aria-labelledby="staff-corrections-heading">
        <StaffV2SectionLabel id="staff-corrections-heading">Corrections</StaffV2SectionLabel>

        {loading && !items.length ? <CorrectionsLoadingRows /> : null}

        {error && !items.length ? (
          <div className={staffV2Styles.inlineError} role="alert">
            <span>
              <strong>Attendance corrections couldn&apos;t load.</strong>
              <small>Please check your connection and try again.</small>
            </span>
            <button onClick={() => void loadInitial()} type="button">Try again</button>
          </div>
        ) : null}

        {!loading && !error && !items.length ? (
          <div className={styles.emptyWrap}>
            <StaffV2EmptyState
              title="No attendance corrections yet."
              description="Attendance issues you submit will appear here."
            />
            <Link href="/staff/history/records">View attendance history</Link>
          </div>
        ) : null}

        {items.length ? (
          <div aria-busy={loadingMore} className={styles.correctionList} role="list">
            {items.map((item) => (
              <CorrectionArchiveRow
                hasMultipleBranches={hasMultipleBranches}
                item={item}
                key={item.sourceKey}
              />
            ))}
          </div>
        ) : null}

        {loadMoreError ? (
          <div className={styles.loadMoreError} role="alert">
            <span>More corrections couldn&apos;t load.</span>
            <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
              Try again
            </button>
          </div>
        ) : null}

        {hasMore && nextCursor ? (
          <button
            className={styles.loadMore}
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? "Loading more…" : "Load more"}
          </button>
        ) : null}

        <p aria-live="polite" className={staffV2Styles.srOnly}>
          {loadingMore ? "Loading more attendance corrections." : `${items.length} attendance corrections loaded.`}
        </p>
      </section>
    </section>
  );
}

export function CorrectionArchiveRow({
  item,
  hasMultipleBranches,
}: {
  item: EmployeeCorrectionArchiveItem;
  hasMultipleBranches: boolean;
}) {
  const status = getEmployeeCorrectionStatusPresentation(item.employeeStatus);
  const correctionType = getEmployeeCorrectionTypeCopy(item.correctionType);
  const requestedSummary = formatRequestedSummary(item);
  const finalResult = getEmployeeCorrectionFinalResultCopy(item.finalDisposition);
  const actionRoute = auditEmployeeCorrectionActionRoute(item);
  const hasRequestedChange = Boolean(item.requestedClockIn || item.requestedClockOut);
  const hasTimeline = item.resolutionEvents.length > 0;
  const hasTimestamps = Boolean(item.submittedAt || item.reviewedAt || item.resolvedAt);

  return (
    <article className={styles.correctionItem} role="listitem">
      <details>
        <summary
          aria-label={`${formatWorkDate(item.workDate)}. ${correctionType}. ${status.label}. Open correction details.`}
        >
          <time dateTime={item.workDate}>{formatShortDate(item.workDate)}</time>
          <span className={styles.rowCopy}>
            <strong>{correctionType}</strong>
            {requestedSummary ? <small>{requestedSummary}</small> : null}
            {hasMultipleBranches ? <small>{item.branchName}</small> : null}
          </span>
          <span className={styles.rowStatus}>
            <StaffV2StatusBadge tone={status.tone}>{status.label}</StaffV2StatusBadge>
          </span>
          <i aria-hidden="true" className={styles.chevron}>›</i>
        </summary>

        <div className={styles.correctionDetail}>
          <StaffV2DetailSection title="Request">
            <dl className={styles.detailFacts}>
              <Fact label="Date" value={formatWorkDate(item.workDate)} />
              <Fact label="Correction type" value={correctionType} />
              {hasMultipleBranches ? <Fact label="Branch" value={item.branchName} /> : null}
              {item.reason ? <Fact label="Reason" value={item.reason} /> : null}
            </dl>
          </StaffV2DetailSection>

          {hasRequestedChange ? (
            <StaffV2DetailSection title="Requested change">
              <dl className={styles.detailFacts}>
                {item.requestedClockIn ? <Fact label="Clock in" value={formatDateTime(item.requestedClockIn)} /> : null}
                {item.requestedClockOut ? <Fact label="Clock out" value={formatDateTime(item.requestedClockOut)} /> : null}
              </dl>
            </StaffV2DetailSection>
          ) : null}

          <StaffV2DetailSection title="Status">
            <div className={styles.statusFact}>
              <StaffV2StatusBadge tone={status.tone}>{status.label}</StaffV2StatusBadge>
              <p>{status.detail}</p>
            </div>
            {hasTimestamps ? (
              <dl className={styles.detailFacts}>
                {item.submittedAt ? <Fact label="Submitted" value={formatDateTime(item.submittedAt)} /> : null}
                {item.reviewedAt ? <Fact label="Reviewed" value={formatDateTime(item.reviewedAt)} /> : null}
                {item.resolvedAt ? <Fact label="Resolved" value={formatDateTime(item.resolvedAt)} /> : null}
              </dl>
            ) : null}
          </StaffV2DetailSection>

          {item.managerNote ? (
            <StaffV2DetailSection title="Manager review">
              <p className={styles.longCopy}>{item.managerNote}</p>
            </StaffV2DetailSection>
          ) : null}

          {hasTimeline ? (
            <StaffV2DetailSection title="Timeline">
              <ol className={styles.timeline}>
                {item.resolutionEvents.map((event, index) => (
                  <li key={`${event.occurredAt}:${index}`}>
                    <strong>{event.employeeFacingSummary}</strong>
                    <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
                  </li>
                ))}
              </ol>
            </StaffV2DetailSection>
          ) : null}

          {finalResult ? (
            <StaffV2DetailSection title="Result">
              <p className={styles.resultCopy}>{finalResult}</p>
            </StaffV2DetailSection>
          ) : null}

        </div>
      </details>

      {actionRoute.status === "SAFE_EXISTING_ROUTE" && actionRoute.href ? (
        <div className={styles.actionState}>
          <span>
            <strong>{status.label}</strong>
            <small>{actionRoute.helper}</small>
          </span>
          <Link href={actionRoute.href}>{actionRoute.label}</Link>
        </div>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function CorrectionsLoadingRows() {
  return (
    <div aria-busy="true" aria-label="Loading attendance corrections" className={styles.loading} role="status">
      <span />
      <span />
      <span />
      <b className={staffV2Styles.srOnly}>Loading attendance corrections…</b>
    </div>
  );
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatWorkDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRequestedSummary(item: EmployeeCorrectionArchiveItem) {
  if (item.requestedClockIn && item.requestedClockOut) {
    return `Requested ${formatTime(item.requestedClockIn)} – ${formatTime(item.requestedClockOut)}`;
  }
  if (item.requestedClockIn) return `Requested clock in ${formatTime(item.requestedClockIn)}`;
  if (item.requestedClockOut) return `Requested clock out ${formatTime(item.requestedClockOut)}`;
  return null;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

import Link from "next/link";
import {
  normalizeGroupLongTermTrendPreset,
  type GroupLongTermTrendPoint,
  type GroupLongTermTrendReport,
} from "@/lib/business-groups/group-long-term-trends";
import type { AllStoresKpiComparison } from "@/lib/business-groups/all-stores-kpi";
import { buildGroupTrendPointReportHref } from "@/lib/business-groups/group-report-navigation";
import { formatDateValue } from "@/lib/business-time";

type OverviewQuery = {
  range?: string;
  from?: string;
  to?: string;
  trend?: string;
};

export function GroupLongTermTrendPanel({
  failed,
  groupId,
  query,
  report,
}: {
  failed: boolean;
  groupId: string;
  query: OverviewQuery;
  report: GroupLongTermTrendReport | null;
}) {
  const selectedPreset =
    report?.preset ?? normalizeGroupLongTermTrendPreset(query.trend);
  const ready = report?.status === "READY" ? report : null;

  return (
    <section
      aria-labelledby="group-long-term-trend-heading"
      className="group-command-section group-long-term-trend"
      data-trend-status={report?.status ?? "ERROR"}
    >
      <div className="section-header group-long-term-trend-header">
        <div>
          <h2 id="group-long-term-trend-heading">Long-term trend</h2>
          <p>
            {ready
              ? `${ready.presetLabel} · ${ready.resolution === "DAY" ? "Daily" : "Monthly"} net sales`
              : "Historical analytics across your current reporting scope."}
          </p>
        </div>
        {ready ? (
          <span className="group-report-currency">
            MYR · {ready.authorizedBusinessCount} currently authorized stores
          </span>
        ) : null}
      </div>

      <nav
        aria-label="Long-term trend range"
        className="group-long-term-range-nav"
      >
        {[
          ["month", "This month"],
          ["ytd", "YTD"],
          ["12months", "12 months"],
        ].map(([preset, label]) => (
          <Link
            aria-current={selectedPreset === preset ? "page" : undefined}
            href={buildTrendHref(groupId, query, preset)}
            key={preset}
          >
            {label}
          </Link>
        ))}
      </nav>

      {!report || report.status === "UNAVAILABLE" ? (
        <div className="group-long-term-unavailable" role="status">
          <div className="group-report-source-note unavailable">
            <strong>Historical trend unavailable</strong>
            <span>
              {failed || !report
                ? "The analytics check could not be completed. Short-range KPI totals remain available above."
                : unavailableReason(report.reason)}
            </span>
          </div>
          <p>
            No partial chart is shown, and Tetamu does not fall back to scanning
            long-range transaction data.
          </p>
        </div>
      ) : (
        <>
          <div className="group-report-source-note verified">
            <strong>Verified daily summaries</strong>
            <span>
              Every in-scope store-day passed membership, version, source-range
              and freshness checks. No-scope periods are shown separately.
            </span>
          </div>

          <div className="group-long-term-summary">
            <article>
              <span>Net sales</span>
              <strong>{formatMoney(report.current.netSalesCents)}</strong>
              <small>
                {formatPeriod(report.fromDateValue, report.toDateValue)}
              </small>
            </article>
            <article>
              <span>Transactions</span>
              <strong>
                {report.current.transactionCount.toLocaleString("en-MY")}
              </strong>
              <small>{report.displaySummaryCount} verified store-days</small>
            </article>
            <article>
              <span>Average transaction</span>
              <strong>
                {report.current.averageTransactionValueCents === null
                  ? "—"
                  : formatMoney(report.current.averageTransactionValueCents)}
              </strong>
              <small>Weighted from group net sales</small>
            </article>
            {report.comparisons.map((item) => (
              <article key={item.key}>
                <span>{item.key === "MOM" ? "MoM" : "YoY"}</span>
                <strong className={comparisonTone(item.comparison)}>
                  {formatComparison(item.comparison)}
                </strong>
                <small>
                  {item.label} · previous{" "}
                  {formatMoney(item.previousNetSalesCents)}
                </small>
              </article>
            ))}
          </div>

          <p className="group-long-term-chart-hint">
            Select an in-scope day or month to open its detailed Group Reports.
          </p>
          <TrendChart
            groupId={groupId}
            points={report.points}
            resolution={report.resolution}
          />

          {report.scopeChanged ? (
            <p className="group-long-term-scope-note">
              Store composition differs inside this period or its comparison
              windows. Each point includes only stores that are currently
              authorized and belonged to the group on that business day.
            </p>
          ) : null}

          <div className="group-long-term-meta">
            <span>
              {report.expectedSummaryCount.toLocaleString("en-MY")} summary rows
              validated, including comparison windows
            </span>
            <span>
              Checked {formatCheckedAt(report.checkedAt)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function TrendChart({
  groupId,
  points,
  resolution,
}: {
  groupId: string;
  points: GroupLongTermTrendPoint[];
  resolution: "DAY" | "MONTH";
}) {
  const maximumMagnitude = Math.max(
    1,
    ...points
      .filter((point) => point.hasCoverage)
      .map((point) => Math.abs(point.netSalesCents)),
  );

  return (
    <div className="group-long-term-chart-scroll">
      <div
        className="group-long-term-chart"
        data-resolution={resolution.toLowerCase()}
        style={{
          gridTemplateColumns: `repeat(${points.length}, minmax(var(--group-long-term-point-width), 1fr))`,
        }}
      >
        {points.map((point) => {
          const direction = !point.hasCoverage
            ? "unavailable"
            : point.netSalesCents > 0
              ? "positive"
              : point.netSalesCents < 0
                ? "negative"
                : "zero";
          const barHeight =
            direction === "unavailable"
              ? 0
              : direction === "zero"
                ? 2
                : Math.max(
                    4,
                    Math.round(
                      (Math.abs(point.netSalesCents) / maximumMagnitude) * 68,
                    ),
                  );
          const label = formatPointLabel(point, resolution);
          const drilldownHref = buildGroupTrendPointReportHref(groupId, point);
          const content = (
            <>
              <span className="group-long-term-chart-value">
                {point.hasCoverage
                  ? compactMoney(point.netSalesCents)
                  : "No scope"}
              </span>
              <span className="group-long-term-chart-plot" aria-hidden="true">
                <span className="group-long-term-chart-baseline" />
                {direction === "unavailable" ? (
                  <span className="group-long-term-chart-gap" />
                ) : (
                  <span
                    className="group-long-term-chart-bar"
                    style={{ height: `${barHeight}px` }}
                  />
                )}
              </span>
              <time dateTime={point.fromDateValue}>{label}</time>
              <small>
                {point.isPartial
                  ? "Partial"
                  : point.hasCoverage
                    ? `${point.storeCount} store${point.storeCount === 1 ? "" : "s"}`
                    : "Not in scope"}
              </small>
            </>
          );

          if (drilldownHref) {
            const drilldownLabel = `View Group Reports for ${formatPointPeriod(point)}; net sales ${formatMoney(point.netSalesCents)}; ${point.storeCount} stores${point.isPartial ? "; partial period" : ""}.`;

            return (
              <Link
                aria-label={drilldownLabel}
                className="group-long-term-chart-point"
                data-direction={direction}
                data-trend-drilldown={point.key}
                href={drilldownHref}
                key={point.key}
                title={drilldownLabel}
              >
                {content}
              </Link>
            );
          }

          return (
            <div
              aria-label={`${label}, no stores in reporting scope`}
              className="group-long-term-chart-point"
              data-direction={direction}
              key={point.key}
            >
              {content}
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Long-term net sales trend values</caption>
        <thead>
          <tr>
            <th>Period</th>
            <th>Net sales</th>
            <th>Stores</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th>{formatPointLabel(point, resolution)}</th>
              <td>
                {point.hasCoverage
                  ? formatMoney(point.netSalesCents)
                  : "Not applicable"}
              </td>
              <td>{point.storeCount}</td>
              <td>
                {point.hasCoverage
                  ? point.isPartial
                    ? "Partial period"
                    : "Complete"
                  : "No stores in scope"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildTrendHref(
  groupId: string,
  query: OverviewQuery,
  trend: string,
) {
  const params = new URLSearchParams({
    range: query.range ?? "today",
    trend,
  });
  if (query.range === "custom" && query.from && query.to) {
    params.set("from", query.from);
    params.set("to", query.to);
  }
  return `/groups/${groupId}/overview?${params.toString()}`;
}

function unavailableReason(reason: string) {
  if (reason === "MISSING_SUMMARIES") {
    return "One or more required store-days have not been summarized yet.";
  }
  if (reason === "STALE_SUMMARIES") {
    return "A source transaction changed after its historical summary was built.";
  }
  if (reason === "VERSION_MISMATCH") {
    return "Historical rows use an older metric or business-day definition.";
  }
  if (reason === "UNSAFE_MEMBERSHIP") {
    return "A partial-day group membership boundary prevents a safe historical total.";
  }
  if (reason === "INVALID_MEMBERSHIP_CONTEXT") {
    return "Complete group membership history is required for this trend.";
  }
  if (reason === "INVALID_RANGE") {
    return "The requested historical window is outside the supported analytics range.";
  }
  return "One or more historical rows failed analytics validation.";
}

function formatComparison(comparison: AllStoresKpiComparison) {
  if (comparison.kind === "NEW") return "New";
  if (comparison.kind === "NO_CHANGE") return "No change";
  if (comparison.kind === "CHANGE") {
    return comparison.direction === "UP" ? "Up" : "Down";
  }
  return `${comparison.percentage >= 0 ? "+" : ""}${comparison.percentage.toFixed(1)}%`;
}

function comparisonTone(comparison: AllStoresKpiComparison) {
  if (comparison.kind === "NEW") return "positive";
  if (comparison.kind === "CHANGE") {
    return comparison.direction === "UP" ? "positive" : "negative";
  }
  if (comparison.kind === "PERCENT") {
    return comparison.percentage >= 0 ? "positive" : "negative";
  }
  return "";
}

function formatPointLabel(
  point: GroupLongTermTrendPoint,
  resolution: "DAY" | "MONTH",
) {
  return formatDateValue(
    point.fromDateValue,
    resolution === "DAY"
      ? { day: "numeric", month: "short" }
      : { month: "short", year: "2-digit" },
  );
}

function formatPointPeriod(point: GroupLongTermTrendPoint) {
  if (point.fromDateValue === point.toDateValue) {
    return formatDateValue(point.fromDateValue, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  return formatPeriod(point.fromDateValue, point.toDateValue);
}

function formatPeriod(fromDateValue: string, toDateValue: string) {
  return `${formatDateValue(fromDateValue, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} – ${formatDateValue(toDateValue, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function formatCheckedAt(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(value);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function compactMoney(cents: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

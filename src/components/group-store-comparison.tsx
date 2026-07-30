import React from "react";
import Link from "next/link";
import { GroupStoreCompareSelector } from "@/components/group-store-compare-selector";
import {
  resolveGroupStoreComparisonSelection,
  type GroupStoreComparisonQuery,
} from "@/lib/business-groups/group-store-comparison";
import { buildAllStoresComparisonHref } from "@/lib/business-groups/group-reports-navigation";
import {
  type GroupReportBusinessPerformance,
  type GroupReportBusinessTrend,
  type GroupReportsResult,
} from "@/lib/business-groups/group-reports";
import { hasGroupStoreActivity } from "@/lib/business-groups/group-store-performance";
import { formatDateValue } from "@/lib/business-time";

const SERIES_COLORS = ["#0f766e", "#2563eb", "#b45309", "#7c3aed"] as const;

export function GroupStoreComparison({
  compareStore,
  groupId,
  report,
}: {
  compareStore: GroupStoreComparisonQuery;
  groupId: string;
  report: GroupReportsResult;
}) {
  const allStoresHref = buildAllStoresComparisonHref(groupId, report.filters);

  if (report.filters.storeId) {
    return (
      <section
        aria-labelledby="group-store-comparison-heading"
        className="group-command-section group-store-comparison"
        data-comparison-status="single-store-filter"
      >
        <ComparisonHeader />
        <div className="group-store-comparison-empty">
          <strong>Single-store filter is active</strong>
          <p>
            Switch to all stores to compare 2–4 locations with the same period,
            payment method and transaction status.
          </p>
          <Link href={allStoresHref}>Compare all stores</Link>
        </div>
      </section>
    );
  }

  const historicalById = new Map(
    report.authorizedBusinesses.map((business) => [
      business.id,
      Boolean(
        business.membershipPeriods?.length &&
          !business.membershipPeriods.some((period) => period.removedAt === null),
      ),
    ]),
  );
  const eligibleIds = report.businessPerformance
    .filter(
      (business) =>
        business.coverage !== "NONE" &&
        !historicalById.get(business.businessId),
    )
    .map((business) => business.businessId);
  const selection = resolveGroupStoreComparisonSelection(
    compareStore,
    eligibleIds,
  );
  const selectedSet = new Set(selection.ids);
  const selectedBusinesses = report.businessPerformance.filter((business) =>
    selectedSet.has(business.businessId),
  );

  return (
    <section
      aria-labelledby="group-store-comparison-heading"
      className="group-command-section group-store-comparison"
      data-comparison-status={
        eligibleIds.length < 2
          ? "insufficient-stores"
          : selection.error
            ? "invalid-selection"
            : "ready"
      }
    >
      <ComparisonHeader />

      {eligibleIds.length < 2 ? (
        <div className="group-store-comparison-empty">
          <strong>At least two stores are needed</strong>
          <p>
            Fewer than two current stores have authorized membership coverage
            in this report period.
          </p>
        </div>
      ) : (
        <>
          <GroupStoreCompareSelector
            key={`${selection.ids.join(":")}:${selection.error ?? "valid"}`}
            action={`/groups/${groupId}/reports`}
            candidates={report.businessPerformance.map((business) => ({
              id: business.businessId,
              name: business.businessName,
              rank: business.rank,
              netSalesCents: business.metrics.netSalesCents,
              coverage: business.coverage,
              isHistorical: historicalById.get(business.businessId) ?? false,
            }))}
            filters={{
              range: report.filters.range,
              from: report.filters.from,
              to: report.filters.to,
              paymentMethod: report.filters.paymentMethod,
              status: report.filters.status,
            }}
            initialSelectedIds={selection.ids}
            selectionError={selection.error}
          />

          <div className="group-store-comparison-toolbar">
            <span>
              {selection.isDefault
                ? "Showing the top 2 stores by net sales"
                : "Showing your saved comparison"}
            </span>
            {!selection.isDefault ? (
              <Link href={allStoresHref}>Use top 2</Link>
            ) : null}
          </div>

          {!selection.error ? (
            <>
              <ComparisonMetricTable businesses={selectedBusinesses} />
              <ComparisonTrendChart
                selectedBusinesses={selectedBusinesses}
                trends={report.businessTrends}
              />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function ComparisonHeader() {
  return (
    <div className="section-header">
      <div>
        <h2 id="group-store-comparison-heading">Store comparison</h2>
        <p>
          Compare net sales, transactions, average transaction value, refunds
          and daily movement on one shared scale.
        </p>
      </div>
      <span className="group-store-comparison-range">2–4 stores</span>
    </div>
  );
}

function ComparisonMetricTable({
  businesses,
}: {
  businesses: GroupReportBusinessPerformance[];
}) {
  const rows = [
    {
      label: "Net sales",
      value: (business: GroupReportBusinessPerformance) =>
        formatMoney(business.metrics.netSalesCents),
    },
    {
      label: "Transactions",
      value: (business: GroupReportBusinessPerformance) =>
        String(business.metrics.transactionCount),
    },
    {
      label: "Average transaction",
      value: (business: GroupReportBusinessPerformance) =>
        business.metrics.averageTransactionValueCents === null
          ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">No transactions</span>
              </>
            )
          : formatMoney(business.metrics.averageTransactionValueCents),
    },
    {
      label: "Refunds",
      value: (business: GroupReportBusinessPerformance) =>
        formatMoney(business.metrics.refundsCents),
    },
  ];

  return (
    <div>
      <p className="group-store-comparison-scroll-hint">
        Swipe or scroll horizontally to compare every store.
      </p>
      <div
        aria-label="Selected store metric comparison"
        className="group-store-comparison-table-scroll"
        role="region"
        tabIndex={0}
      >
        <table
          className="group-store-comparison-table"
          data-store-count={businesses.length}
        >
          <caption>Selected store KPI comparison</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {businesses.map((business, index) => (
                <th scope="col" key={business.businessId}>
                  <span
                    aria-hidden="true"
                    className="group-store-comparison-dot"
                    style={{ backgroundColor: SERIES_COLORS[index] }}
                  />
                  <strong>{business.businessName}</strong>
                  <small>
                    #{business.rank}
                    {business.coverage === "PARTIAL"
                      ? " · Partial membership period"
                      : !hasGroupStoreActivity(business.metrics)
                        ? " · No activity"
                        : ""}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {businesses.map((business) => (
                  <td key={business.businessId}>{row.value(business)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonTrendChart({
  selectedBusinesses,
  trends,
}: {
  selectedBusinesses: GroupReportBusinessPerformance[];
  trends: GroupReportBusinessTrend[];
}) {
  const trendByBusiness = new Map(
    trends.map((trend) => [trend.businessId, trend]),
  );
  const selectedTrends = selectedBusinesses.flatMap((business) => {
    const trend = trendByBusiness.get(business.businessId);
    return trend ? [{ business, trend }] : [];
  });
  const dates = [
    ...new Set(
      selectedTrends.flatMap(({ trend }) =>
        trend.points.map((point) => point.businessDate),
      ),
    ),
  ].sort();
  const pointByBusiness = new Map(
    selectedTrends.map(({ business, trend }) => [
      business.businessId,
      new Map(trend.points.map((point) => [point.businessDate, point])),
    ]),
  );
  const maximumMagnitude = Math.max(
    1,
    ...selectedTrends.flatMap(({ trend }) =>
      trend.points
        .filter((point) => point.coverage !== "NONE")
        .map((point) => Math.abs(point.netSalesCents)),
    ),
  );

  return (
    <div className="group-store-comparison-trend">
      <div className="group-store-comparison-trend-header">
        <div>
          <h3>Net sales trend comparison</h3>
          <p>Shared scale and zero baseline across the selected stores.</p>
        </div>
        <ul aria-label="Store trend legend">
          {selectedBusinesses.map((business, index) => (
            <li key={business.businessId}>
              <span
                aria-hidden="true"
                data-series={index}
              />
              {business.businessName}
            </li>
          ))}
        </ul>
      </div>

      <p className="group-store-comparison-scroll-hint">
        Swipe or scroll horizontally to inspect the complete trend.
      </p>
      <div
        aria-label="Selected store net sales trend comparison"
        className="group-store-comparison-chart-scroll"
        role="region"
        tabIndex={0}
      >
        <div
          aria-hidden="true"
          className="group-store-comparison-chart"
          style={{
            gridTemplateColumns: `repeat(${dates.length}, minmax(86px, 1fr))`,
          }}
        >
          {dates.map((date) => (
            <div className="group-store-comparison-chart-point" key={date}>
              <span className="group-store-comparison-chart-plot">
                <span className="group-store-comparison-baseline" />
                {selectedBusinesses.map((business, index) => {
                  const point = pointByBusiness
                    .get(business.businessId)
                    ?.get(date);
                  const value =
                    point && point.coverage !== "NONE"
                      ? point.netSalesCents
                      : null;
                  const direction =
                    value === null
                      ? "unavailable"
                      : value > 0
                        ? "positive"
                        : value < 0
                          ? "negative"
                          : "zero";
                  const height =
                    value === null
                      ? 0
                      : value === 0
                      ? 2
                      : Math.max(
                          4,
                          Math.round(
                            (Math.abs(value) / maximumMagnitude) * 62,
                          ),
                        );
                  return (
                    <span
                      className="group-store-comparison-bar-slot"
                      key={business.businessId}
                    >
                      <span
                        className="group-store-comparison-bar"
                        data-coverage={point?.coverage.toLowerCase() ?? "none"}
                        data-direction={direction}
                        data-series={index}
                        style={{ height: `${height}px` }}
                        title={
                          value === null
                            ? `${business.businessName}, ${formatReportDate(date)}: not in membership scope`
                            : `${business.businessName}, ${formatReportDate(date)}: ${formatMoney(value)}${point?.coverage === "PARTIAL" ? " (partial membership coverage)" : ""}`
                        }
                      />
                    </span>
                  );
                })}
              </span>
              <time dateTime={date}>{formatShortDate(date)}</time>
            </div>
          ))}
        </div>

        <details className="group-store-comparison-data">
          <summary>Show exact trend data</summary>
          <div className="group-store-comparison-data-scroll">
            <table>
          <caption>Selected store daily net sales comparison</caption>
          <thead>
            <tr>
              <th scope="col">Business date</th>
              {selectedBusinesses.map((business) => (
                <th scope="col" key={business.businessId}>
                  {business.businessName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date}>
                <th scope="row">{formatReportDate(date)}</th>
                {selectedBusinesses.map((business) => {
                  const point = pointByBusiness
                    .get(business.businessId)
                    ?.get(date);
                  return (
                    <td key={business.businessId}>
                      {!point || point.coverage === "NONE"
                        ? "Not in scope"
                        : `${formatMoney(point.netSalesCents)}${
                            point.coverage === "PARTIAL"
                              ? " · Partial coverage"
                              : ""
                          }`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </details>
      </div>
    </div>
  );
}

function formatShortDate(value: string) {
  return formatDateValue(value, {
    day: "2-digit",
    month: "short",
  });
}

function formatReportDate(value: string) {
  return formatDateValue(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(value / 100);
}

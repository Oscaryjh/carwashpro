import Link from "next/link";

export type ReportFilterRange = "today" | "7days" | "month" | "custom";

type ReportFilterPanelProps = {
  activeRange: ReportFilterRange;
  fromValue: string;
  selectedBranchId: string | null;
  toValue: string;
};

const REPORT_RANGES: Array<{ label: string; value: ReportFilterRange }> = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "7days" },
  { label: "Month", value: "month" },
  { label: "Custom", value: "custom" },
];

export function ReportFilterPanel({
  activeRange,
  fromValue,
  selectedBranchId,
  toValue,
}: ReportFilterPanelProps) {
  const showsCustomDates = activeRange === "custom";

  return (
    <div className="panel report-filter-panel">
      <nav className="filter-tabs report-range-tabs" aria-label="Report period">
        {REPORT_RANGES.map((range) => (
          <Link
            key={range.value}
            className={activeRange === range.value ? "active" : ""}
            href={reportRangeHref(range.value, selectedBranchId)}
          >
            {range.label}
          </Link>
        ))}
      </nav>
      {showsCustomDates ? (
        <form
          className="report-filter-form report-filter-form-custom"
          action="/reports"
        >
          <input type="hidden" name="range" value={activeRange} />
          {selectedBranchId ? (
            <input type="hidden" name="branchId" value={selectedBranchId} />
          ) : null}
          <label>
            <span>From</span>
            <input type="date" name="from" defaultValue={fromValue} />
          </label>
          <label>
            <span>To</span>
            <input type="date" name="to" defaultValue={toValue} />
          </label>
          <button type="submit">Run report</button>
        </form>
      ) : null}
    </div>
  );
}

function reportRangeHref(range: ReportFilterRange, branchId: string | null) {
  const params = new URLSearchParams({ range });

  if (branchId) {
    params.set("branchId", branchId);
  }

  return `/reports?${params.toString()}`;
}

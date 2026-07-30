import type { GroupReportFilters } from "@/lib/business-groups/group-reports";

export type GroupReportsSearchQuery = {
  range?: string;
  from?: string;
  to?: string;
  store?: string;
  paymentMethod?: string;
  status?: string;
  page?: string;
  compareStore?: string | string[];
};

export function buildGroupReportsPageHref(
  groupId: string,
  query: GroupReportsSearchQuery,
  page: number,
) {
  const params = new URLSearchParams();
  appendQuery(params, query, new Set(["page"]));
  params.set("page", String(page));
  return `/groups/${encodeURIComponent(groupId)}/reports?${params.toString()}`;
}

export function buildGroupReportExportHref(
  groupId: string,
  query: GroupReportsSearchQuery,
  format: "csv" | "xlsx" | "pdf",
) {
  const params = new URLSearchParams();
  appendQuery(params, query, new Set(["page", "compareStore"]));
  params.set("format", format);
  return `/groups/${encodeURIComponent(groupId)}/reports/export?${params.toString()}`;
}

export function buildAllStoresComparisonHref(
  groupId: string,
  filters: GroupReportFilters,
) {
  const params = new URLSearchParams({
    range: filters.range,
    store: "all",
    paymentMethod: filters.paymentMethod ?? "all",
    status: filters.status ?? "all",
    page: "1",
  });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/groups/${encodeURIComponent(groupId)}/reports?${params.toString()}`;
}

function appendQuery(
  params: URLSearchParams,
  query: GroupReportsSearchQuery,
  excludedKeys: ReadonlySet<string>,
) {
  for (const [key, value] of Object.entries(query)) {
    if (excludedKeys.has(key)) continue;
    for (const item of queryValues(value)) {
      params.append(key, item);
    }
  }
}

function queryValues(value: unknown) {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

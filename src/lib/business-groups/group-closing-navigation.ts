export type GroupClosingSearchQuery = {
  range?: string;
  from?: string;
  to?: string;
  store?: string;
  status?: string;
  page?: string;
  auditPage?: string;
};

export function buildGroupClosingRecordsPageHref(
  groupId: string,
  query: GroupClosingSearchQuery,
  page: number,
) {
  return buildPageHref(groupId, query, "page", page);
}

export function buildGroupClosingAuditPageHref(
  groupId: string,
  query: GroupClosingSearchQuery,
  page: number,
) {
  return buildPageHref(groupId, query, "auditPage", page);
}

export function buildGroupClosingExportHref(
  groupId: string,
  query: GroupClosingSearchQuery,
  format: "csv" | "xlsx" | "pdf",
) {
  const params = new URLSearchParams();
  appendQuery(params, query, new Set(["page", "auditPage"]));
  params.set("format", format);
  return `/groups/${encodeURIComponent(groupId)}/closing/export?${params.toString()}`;
}

function buildPageHref(
  groupId: string,
  query: GroupClosingSearchQuery,
  key: "page" | "auditPage",
  page: number,
) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("Closing page must be a positive safe integer.");
  }
  const params = new URLSearchParams();
  appendQuery(params, query, new Set([key]));
  params.set(key, String(page));
  return `/groups/${encodeURIComponent(groupId)}/closing?${params.toString()}`;
}

function appendQuery(
  params: URLSearchParams,
  query: GroupClosingSearchQuery,
  excludedKeys: ReadonlySet<string>,
) {
  for (const [key, value] of Object.entries(query)) {
    if (excludedKeys.has(key)) continue;
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }
}

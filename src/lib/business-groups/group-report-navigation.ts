import type {
  AllStoresKpiReport,
  AllStoresRange,
} from "@/lib/business-groups/all-stores-kpi";
import type { GroupLongTermTrendPoint } from "@/lib/business-groups/group-long-term-trends";

type GroupTrendReportPoint = Pick<
  GroupLongTermTrendPoint,
  "fromDateValue" | "hasCoverage" | "toDateValue"
>;

export function buildGroupTrendPointReportHref(
  groupId: string,
  point: GroupTrendReportPoint,
) {
  if (!point.hasCoverage) return null;

  return buildGroupReportHref(groupId, {
    range: "custom",
    from: point.fromDateValue,
    to: point.toDateValue,
    store: "all",
  });
}

type GroupStoreReportContext = Pick<
  AllStoresKpiReport,
  "customFrom" | "customTo" | "range"
>;

export function buildGroupStorePerformanceReportHref(
  groupId: string,
  businessId: string,
  context: GroupStoreReportContext,
) {
  if (
    context.range === "custom" &&
    (!context.customFrom || !context.customTo)
  ) {
    return null;
  }

  return buildGroupReportHref(groupId, {
    range: context.range,
    from: context.range === "custom" ? context.customFrom : null,
    to: context.range === "custom" ? context.customTo : null,
    store: businessId,
  });
}

function buildGroupReportHref(
  groupId: string,
  input: {
    range: AllStoresRange;
    from: string | null;
    to: string | null;
    store: string;
  },
) {
  const params = new URLSearchParams({
    range: input.range,
    store: input.store,
    paymentMethod: "all",
    status: "all",
    page: "1",
  });
  if (input.range === "custom" && input.from && input.to) {
    params.set("from", input.from);
    params.set("to", input.to);
  }

  return `/groups/${encodeURIComponent(groupId)}/reports?${params.toString()}`;
}

import { GroupLongTermTrendPanel } from "@/components/group-long-term-trend-panel";
import {
  getGroupLongTermTrendReport,
  type GroupLongTermTrendReport,
} from "@/lib/business-groups/group-long-term-trends";
import type { AuthorizedGroupReportingContext } from "@/lib/business-groups/all-stores-access";
import type { resolveAuthorizedGroupReportingScope } from "@/lib/business-groups/all-stores-access";

type GroupOverviewTrendQuery = {
  range?: string;
  from?: string;
  to?: string;
  trend?: string;
};

type GroupLongTermTrendLoadResult = {
  report: GroupLongTermTrendReport | null;
  failed: boolean;
};

type GroupLongTermTrendLoadDependencies = {
  cacheTtlMs?: number;
  now?: Date;
  resolveScope?: typeof resolveAuthorizedGroupReportingScope;
};

export function startGroupLongTermTrendLoad(
  input: {
    userId: string;
    groupId: string;
    activeBusinessId: string;
    preset?: string;
  },
  dependencies: GroupLongTermTrendLoadDependencies = {},
): Promise<GroupLongTermTrendLoadResult> {
  return getGroupLongTermTrendReport(input, undefined, dependencies)
    .then((report) => ({ report, failed: false }))
    .catch(() => {
      console.error("[group-long-term-trend] Unable to load historical trend.");
      return { report: null, failed: true };
    });
}

export async function GroupLongTermTrendSection({
  activeBusinessId,
  authorizedScope,
  groupId,
  preset,
  query,
  userId,
}: {
  activeBusinessId: string;
  authorizedScope: AuthorizedGroupReportingContext;
  groupId: string;
  preset?: string;
  query: GroupOverviewTrendQuery;
  userId: string;
}) {
  const { failed, report } = await startGroupLongTermTrendLoad(
    {
      userId,
      groupId,
      activeBusinessId,
      preset,
    },
    {
      cacheTtlMs: 30_000,
      resolveScope: async (
        requestedUserId,
        requestedGroupId,
        requestedBusinessId,
      ) =>
        requestedUserId === userId &&
        requestedGroupId === groupId &&
        requestedBusinessId === activeBusinessId
          ? authorizedScope
          : null,
    },
  );

  return (
    <GroupLongTermTrendPanel
      failed={failed}
      groupId={groupId}
      query={query}
      report={report}
    />
  );
}

export function GroupLongTermTrendFallback() {
  return (
    <section
      aria-busy="true"
      aria-labelledby="group-long-term-trend-loading-heading"
      className="group-command-section group-long-term-trend"
      data-trend-status="LOADING"
    >
      <div className="section-header group-long-term-trend-header">
        <div>
          <h2 id="group-long-term-trend-loading-heading">Long-term trend</h2>
          <p>Loading verified historical analytics.</p>
        </div>
      </div>

      <div className="group-long-term-unavailable" role="status">
        <div className="group-report-source-note">
          <strong>Checking daily summaries</strong>
          <span>
            Membership, metric version, source range and freshness checks are
            running.
          </span>
        </div>
      </div>
    </section>
  );
}

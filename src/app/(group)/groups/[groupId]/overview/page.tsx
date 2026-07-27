import { notFound, redirect } from "next/navigation";
import { AppShellFrame, type NavItem } from "@/components/app-shell-frame";
import { BusinessContextDrilldownButton } from "@/components/business-context-drilldown-button";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
import { createBusinessContextToken } from "@/lib/auth/business-context-token";
import { requireUser } from "@/lib/auth/session";
import {
  getAvailableGroupReportingContexts,
  resolveAuthorizedGroupReportingScope,
} from "@/lib/business-groups/all-stores-access";
import { getAvailableBusinessContexts } from "@/lib/business-groups/business-context";
import { getBusinessIndustryLabel } from "@/lib/business-industry";

const overviewNav: NavItem[] = [
  {
    href: "/groups",
    label: "All Stores",
    shortLabel: "All",
    icon: "businesses",
  },
];

export default async function GroupOverviewPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const user = await requireUser();
  if (user.role === "PLATFORM_ADMIN") {
    notFound();
  }
  if (!user.activeBusinessId) {
    redirect("/business-context/recover");
  }

  const { groupId } = await params;
  const [scope, groups, businessContexts] = await Promise.all([
    resolveAuthorizedGroupReportingScope(
      user.userId,
      groupId,
      user.activeBusinessId,
    ),
    getAvailableGroupReportingContexts(user.userId, user.activeBusinessId),
    getAvailableBusinessContexts(user.userId, user.activeBusinessId),
  ]);
  if (!scope || !scope.canViewAllStores) {
    notFound();
  }

  const contextToken = await createBusinessContextToken({
    userId: user.userId,
    businessId: user.activeBusinessId,
    contextVersion: user.contextVersion,
  });
  const navItems = overviewNav.map((item) => ({
    ...item,
    href: `/groups/${scope.groupId}/overview`,
  }));

  return (
    <AppShellFrame
      brandName={scope.groupName}
      homeHref={`/groups/${scope.groupId}/overview`}
      navItems={navItems}
      businessSwitcher={
        <BusinessContextSwitcher
          groups={groups}
          homeBusiness={
            businessContexts.businesses.find((business) => business.isHome) ??
            null
          }
          contextToken={contextToken}
          selectedGroupId={scope.groupId}
        />
      }
    >
      <div className="content group-overview-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Business Group</p>
            <h1>All Stores</h1>
            <p>
              {scope.groupName} · {scope.businesses.length} active stores in
              your reporting scope
            </p>
          </div>
        </header>

        <section className="group-overview-intro">
          <div>
            <h2>Group overview</h2>
            <p>
              This view is read-only. Select a store to enter its live business
              context.
            </p>
          </div>
          <span>{scope.role === "GROUP_OWNER" ? "Group Owner" : "Group Manager"}</span>
        </section>

        <section aria-labelledby="authorized-stores-heading">
          <div className="section-header">
            <div>
              <h2 id="authorized-stores-heading">Authorized stores</h2>
              <p>Only active stores in this group and your current scope appear here.</p>
            </div>
          </div>
          <div className="group-store-list">
            {scope.businesses.map((business) => (
              <article className="group-store-row" key={business.id}>
                <div className="group-store-identity">
                  {business.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={business.logoUrl} />
                  ) : (
                    <span aria-hidden="true">
                      {business.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <h3>{business.name}</h3>
                    <p>{getBusinessIndustryLabel(business.industryType)}</p>
                  </div>
                </div>
                <div className="group-store-row-actions">
                  {business.isCurrent ? <span>Current store</span> : null}
                  <BusinessContextDrilldownButton
                    businessId={business.id}
                    contextToken={contextToken}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="group-overview-placeholder">
          <div>
            <h2>Group performance</h2>
            <p>
              Sales and operational comparisons will be added in the next
              stage.
            </p>
          </div>
          <span>Stage 3B</span>
        </section>
      </div>
    </AppShellFrame>
  );
}

import Link from "next/link";

type LoyaltyTab = "overview" | "members" | "activity" | "settings";

const tabs: Array<{ key: LoyaltyTab; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/loyalty" },
  { key: "members", label: "Members", href: "/loyalty/members" },
  { key: "settings", label: "Program Settings", href: "/loyalty/settings" },
];

export function LoyaltyTabs({
  active,
  showSettings = false,
}: {
  active: LoyaltyTab;
  showSettings?: boolean;
}) {
  const visibleTabs = showSettings
    ? tabs
    : tabs.filter((tab) => tab.key !== "settings");

  return (
    <nav className="filter-tabs loyalty-tabs" aria-label="Membership sections">
      {visibleTabs.map((tab) => (
        <Link
          key={tab.key}
          className={active === tab.key ? "active" : ""}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

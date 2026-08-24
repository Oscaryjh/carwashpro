"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { shouldPollWhatsAppUnread } from "@/lib/whatsapp/unread-access";

export type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: IconName;
  badgeCount?: number;
  children?: NavItem[];
};

type AppShellFrameProps = {
  brandName: string;
  logoUrl?: string | null;
  brandLogoControl?: ReactNode;
  homeHref: string;
  navItems: NavItem[];
  businessSwitcher?: ReactNode;
  children: ReactNode;
};

const SIDEBAR_STORAGE_KEY = "washflow-sidebar-collapsed";

export function AppShellFrame({
  brandName,
  logoUrl,
  brandLogoControl,
  homeHref,
  navItems,
  businessSwitcher,
  children,
}: AppShellFrameProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const initialWhatsAppUnreadCount =
    flattenNavItems(navItems).find((item) => item.icon === "whatsapp")
      ?.badgeCount ?? 0;
  const [whatsAppUnreadCount, setWhatsAppUnreadCount] = useState(
    initialWhatsAppUnreadCount,
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const activeGroups = Object.fromEntries(
      navItems
        .filter((item) =>
          item.children?.some((child) =>
            isActiveNavItem(pathname, child.href, searchParams),
          ),
        )
        .map((item) => [item.href, true]),
    );
    if (Object.keys(activeGroups).length) {
      setOpenGroups((current) => ({ ...current, ...activeGroups }));
    }
  }, [navItems, pathname, searchParams]);

  useEffect(() => {
    setIsCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    setWhatsAppUnreadCount(initialWhatsAppUnreadCount);
  }, [initialWhatsAppUnreadCount]);

  useEffect(() => {
    if (!shouldPollWhatsAppUnread(navItems)) {
      return;
    }

    let isActive = true;

    async function refreshUnreadCount() {
      try {
        const response = await fetch("/api/whatsapp/unread", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { unreadCount?: number };

        if (isActive) {
          setWhatsAppUnreadCount(payload.unreadCount ?? 0);
        }
      } catch {
        // Keep the last known count if the dev server is rebuilding or offline.
      }
    }

    void refreshUnreadCount();
    const intervalId = window.setInterval(refreshUnreadCount, 7000);
    window.addEventListener("focus", refreshUnreadCount);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshUnreadCount);
    };
  }, [navItems]);

  function toggleSidebar() {
    setIsCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className={`app-shell${isCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand-row">
          {brandLogoControl ? (
            <div className="brand brand-with-control" title={brandName}>
              {brandLogoControl}
              <Link className="brand-name-link" href={homeHref}>
                <span className="brand-name">{brandName}</span>
              </Link>
            </div>
          ) : (
            <Link href={homeHref} className="brand" title={brandName}>
              {logoUrl && logoUrl !== failedLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  onError={() => setFailedLogoUrl(logoUrl)}
                />
              ) : (
                <span aria-hidden="true" className="brand-fallback">
                  {brandInitials(brandName)}
                </span>
              )}
              <span className="brand-name">{brandName}</span>
            </Link>
          )}
        </div>
        <nav>
          {navItems.map((item) => {
            if (item.children?.length) {
              const groupActive = item.children.some((child) =>
                isActiveNavItem(pathname, child.href, searchParams),
              );
              const groupOpen = openGroups[item.href] ?? groupActive;

              return (
                <div
                  className={`nav-group${groupOpen ? " open" : ""}`}
                  key={item.href}
                >
                  <button
                    aria-expanded={groupOpen}
                    className={`nav-group-toggle${groupActive ? " active" : ""}`}
                    onClick={() => {
                      if (isCollapsed) {
                        setIsCollapsed(false);
                        localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");
                      }
                      setOpenGroups((current) => ({
                        ...current,
                        [item.href]: !groupOpen,
                      }));
                    }}
                    title={item.label}
                    type="button"
                  >
                    <ShellIcon name={item.icon} />
                    <span className="nav-label">{item.label}</span>
                    <span aria-hidden="true" className="nav-group-chevron">
                      &gt;
                    </span>
                  </button>
                  {groupOpen ? (
                    <div className="nav-group-children">
                      {item.children.map((child) => (
                        <Link
                          className={
                            isActiveNavItem(pathname, child.href, searchParams)
                              ? "active"
                              : undefined
                          }
                          data-short={child.shortLabel}
                          href={child.href}
                          key={child.href}
                          title={child.label}
                        >
                          <ShellIcon name={child.icon} />
                          <span className="nav-label">{child.label}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }
            const badgeCount =
              item.icon === "whatsapp"
                ? whatsAppUnreadCount
                : (item.badgeCount ?? 0);

            return (
              <Link
                className={
                  isActiveNavItem(pathname, item.href, searchParams)
                    ? "active"
                    : undefined
                }
                href={item.href}
                key={item.href}
                title={
                  badgeCount > 0
                    ? `${item.label}: ${badgeCount} unread`
                    : item.label
                }
                data-short={item.shortLabel}
              >
                <ShellIcon name={item.icon} />
                <span className="nav-label">{item.label}</span>
                {badgeCount > 0 ? (
                  <span
                    className="nav-badge"
                    aria-label={`${badgeCount} unread`}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <PwaInstallButton />
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? ">" : "<"}
          </button>
          <form action="/logout" method="post">
            <button className="secondary-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main">
        {businessSwitcher ? (
          <div className="business-context-toolbar">{businessSwitcher}</div>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ? flattenNavItems(item.children) : []),
  ]);
}

function brandInitials(brandName: string) {
  return (
    brandName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "TP"
  );
}

function isActiveNavItem(
  pathname: string | null,
  href: string,
  searchParams?: Pick<URLSearchParams, "get"> | null,
) {
  if (!pathname) {
    return false;
  }

  const [pathAndQuery] = href.split("#", 1);
  const [targetPath = href, targetQuery = ""] = pathAndQuery.split("?", 2);

  if (targetQuery) {
    const targetParams = new URLSearchParams(targetQuery);
    for (const [key, value] of targetParams) {
      if (searchParams?.get(key) !== value) {
        return false;
      }
    }
  }

  if (targetPath === "/dashboard") {
    return pathname === targetPath;
  }

  if (targetPath === "/admin/businesses") {
    return pathname.startsWith("/admin/businesses");
  }

  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

type IconName =
  | "accountSecurity"
  | "appointments"
  | "askTetamu"
  | "branches"
  | "businessGroups"
  | "businesses"
  | "cashier"
  | "catalog"
  | "companySettings"
  | "commercial"
  | "crm"
  | "dashboard"
  | "discounts"
  | "expenses"
  | "invoices"
  | "inventory"
  | "jobs"
  | "membership"
  | "otpSupport"
  | "packages"
  | "permissions"
  | "pos"
  | "products"
  | "reports"
  | "security"
  | "services"
  | "settings"
  | "shiftClosing"
  | "team"
  | "statutory"
  | "vehicle"
  | "whatsapp";

function ShellIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    accountSecurity: (
      <>
        <circle cx="8" cy="12" r="4" />
        <path d="M12 12h9M17 12v3M20 12v2" />
      </>
    ),
    appointments: (
      <>
        <rect x="5" y="5" width="14" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M5 10h14" />
        <path d="M9 14h2M13 14h2M9 17h2" />
      </>
    ),
    askTetamu: (
      <>
        <path d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3z" />
        <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
      </>
    ),
    branches: (
      <>
        <path d="M6 20V8l6-4 6 4v12" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    businesses: (
      <>
        <path d="M4 20V6h16v14" />
        <path d="M8 10h2M14 10h2M8 14h2M14 14h2" />
      </>
    ),
    businessGroups: (
      <>
        <rect x="9" y="3" width="6" height="5" rx="1" />
        <rect x="3" y="16" width="6" height="5" rx="1" />
        <rect x="15" y="16" width="6" height="5" rx="1" />
        <path d="M12 8v4M6 16v-4h12v4" />
      </>
    ),
    cashier: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M7 7h10v5H7zM7 16h3M13 16h4" />
      </>
    ),
    catalog: (
      <>
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 4H12v16H7.5A3.5 3.5 0 0 0 4 21V5.5z" />
        <path d="M20 5.5A3.5 3.5 0 0 0 16.5 4H12v16h4.5A3.5 3.5 0 0 1 20 21V5.5z" />
      </>
    ),
    companySettings: (
      <>
        <path d="M4 20V7l6-3 6 3v5M8 9h2M8 13h2" />
        <circle cx="17" cy="17" r="2" />
        <path d="M17 13v2M17 19v2M13 17h2M19 17h2M14.2 14.2l1.4 1.4M18.4 18.4l1.4 1.4M19.8 14.2l-1.4 1.4M15.6 18.4l-1.4 1.4" />
      </>
    ),
    commercial: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </>
    ),
    crm: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    dashboard: (
      <>
        <path d="M4 13a8 8 0 0 1 16 0" />
        <path d="M12 13l4-4" />
        <path d="M6.8 18h10.4" />
      </>
    ),
    discounts: (
      <>
        <path d="M4 6a2 2 0 0 1 2-2h7l7 7-9 9-7-7V6z" />
        <circle cx="9" cy="9" r="1" />
        <path d="M10 16l5-5" />
      </>
    ),
    expenses: (
      <>
        <path d="M6 3h12v18l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    invoices: (
      <>
        <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1V3z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    inventory: (
      <>
        <path d="M4 7l4-3 4 3-4 3-4-3zM12 7l4-3 4 3-4 3-4-3z" />
        <path d="M4 14l4-3 4 3-4 3-4-3zM12 14l4-3 4 3-4 3-4-3z" />
      </>
    ),
    jobs: (
      <>
        <path d="M6 7h12v13H6z" />
        <path d="M9 7V5h6v2" />
        <path d="M9 12h6M9 16h4" />
      </>
    ),
    membership: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8" cy="11" r="2" />
        <path d="M6 16c.7-1.5 3.3-1.5 4 0M13 10h5M13 14h4" />
      </>
    ),
    otpSupport: (
      <>
        <path d="M4 7h16v10H4z" />
        <path d="M7 10h1M11 10h1M15 10h1M7 14h10" />
        <path d="M18 5v2M6 5v2" />
      </>
    ),
    packages: (
      <>
        <path d="M4 8l8-4 8 4-8 4-8-4z" />
        <path d="M4 8v8l8 4 8-4V8" />
        <path d="M12 12v8" />
      </>
    ),
    permissions: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M4 20v-2a5 5 0 0 1 8-4M15 16l2 2 4-5" />
      </>
    ),
    pos: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h8M8 13h3M14 13h2M8 16h2M13 16h3" />
      </>
    ),
    products: (
      <>
        <path d="M6 8h12l-1 12H7L6 8z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    reports: (
      <>
        <path d="M5 20V4" />
        <path d="M9 20v-7" />
        <path d="M13 20V8" />
        <path d="M17 20v-4" />
      </>
    ),
    security: (
      <>
        <path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z" />
        <rect x="9" y="11" width="6" height="5" rx="1" />
        <path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11" />
      </>
    ),
    services: (
      <>
        <path d="M5 12h14" />
        <path d="M7 8h10" />
        <path d="M8 16h8" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 3.1h5l.3-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z" />
      </>
    ),
    shiftClosing: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V2h6v2M8 11l2.5 2.5L16 8M8 17h8" />
      </>
    ),
    statutory: (
      <>
        <path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    team: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-3-3.9" />
        <path d="M8 21v-2a4 4 0 0 1 8 0v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M19 8a3 3 0 1 1-2.2-2.9" />
      </>
    ),
    vehicle: (
      <>
        <path d="M5 16l1.5-6h11L19 16" />
        <path d="M3 16h18v3H3zM8 10l1-3h6l1 3" />
        <circle cx="7" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
      </>
    ),
    whatsapp: (
      <>
        <path d="M5 20l1.2-3.5A8 8 0 1 1 9 19.2L5 20z" />
        <path d="M9.5 8.8c.4 2 1.8 3.4 3.8 3.9l1-1.1 2 .8-.3 2.1c-4.5.5-8-3-7.5-7.5l2.1-.3.8 2-1.9 1z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="sidebar-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

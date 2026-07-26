"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";

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
  homeHref: string;
  navItems: NavItem[];
  children: ReactNode;
};

const SIDEBAR_STORAGE_KEY = "washflow-sidebar-collapsed";

export function AppShellFrame({
  brandName,
  logoUrl,
  homeHref,
  navItems,
  children,
}: AppShellFrameProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const initialWhatsAppUnreadCount =
    flattenNavItems(navItems).find((item) => item.icon === "whatsapp")?.badgeCount ?? 0;
  const [whatsAppUnreadCount, setWhatsAppUnreadCount] = useState(
    initialWhatsAppUnreadCount,
  );
  const pathname = usePathname();

  useEffect(() => {
    const activeGroups = Object.fromEntries(
      navItems
        .filter((item) => item.children?.some((child) => isActiveNavItem(pathname, child.href)))
        .map((item) => [item.href, true]),
    );
    if (Object.keys(activeGroups).length) {
      setOpenGroups((current) => ({ ...current, ...activeGroups }));
    }
  }, [navItems, pathname]);

  useEffect(() => {
    setIsCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    setWhatsAppUnreadCount(initialWhatsAppUnreadCount);
  }, [initialWhatsAppUnreadCount]);

  useEffect(() => {
    if (!flattenNavItems(navItems).some((item) => item.icon === "whatsapp")) {
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
          <Link href={homeHref} className="brand" title={brandName}>
            {logoUrl && logoUrl !== failedLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" onError={() => setFailedLogoUrl(logoUrl)} />
            ) : (
              <span aria-hidden="true" className="brand-fallback">
                {brandInitials(brandName)}
              </span>
            )}
            <span className="brand-name">{brandName}</span>
          </Link>
        </div>
        <nav>
          {navItems.map((item) => {
            if (item.children?.length) {
              const groupActive = item.children.some((child) => isActiveNavItem(pathname, child.href));
              const groupOpen = openGroups[item.href] ?? groupActive;

              return (
                <div className={`nav-group${groupOpen ? " open" : ""}`} key={item.href}>
                  <button
                    aria-expanded={groupOpen}
                    className={`nav-group-toggle${groupActive ? " active" : ""}`}
                    onClick={() => {
                      if (isCollapsed) {
                        setIsCollapsed(false);
                        localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");
                      }
                      setOpenGroups((current) => ({ ...current, [item.href]: !groupOpen }));
                    }}
                    title={item.label}
                    type="button"
                  >
                    <ShellIcon name={item.icon} />
                    <span className="nav-label">{item.label}</span>
                    <span aria-hidden="true" className="nav-group-chevron">&gt;</span>
                  </button>
                  {groupOpen ? (
                    <div className="nav-group-children">
                      {item.children.map((child) => (
                        <Link
                          className={isActiveNavItem(pathname, child.href) ? "active" : undefined}
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
                : item.badgeCount ?? 0;

            return (
              <Link
                className={isActiveNavItem(pathname, item.href) ? "active" : undefined}
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
                  <span className="nav-badge" aria-label={`${badgeCount} unread`}>
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
      <main className="main">{children}</main>
    </div>
  );
}

function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenNavItems(item.children) : [])]);
}

function brandInitials(brandName: string) {
  return brandName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TP";
}

function isActiveNavItem(pathname: string | null, href: string) {
  if (!pathname) {
    return false;
  }

  if (href === "/dashboard") {
    return pathname === href;
  }

  if (href === "/admin/businesses") {
    return pathname.startsWith("/admin/businesses");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

type IconName =
  | "appointments"
  | "branches"
  | "businesses"
  | "crm"
  | "dashboard"
  | "invoices"
  | "jobs"
  | "packages"
  | "pos"
  | "reports"
  | "services"
  | "settings"
  | "team"
  | "whatsapp";

function ShellIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    appointments: (
      <>
        <rect x="5" y="5" width="14" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M5 10h14" />
        <path d="M9 14h2M13 14h2M9 17h2" />
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
    invoices: (
      <>
        <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1V3z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    jobs: (
      <>
        <path d="M6 7h12v13H6z" />
        <path d="M9 7V5h6v2" />
        <path d="M9 12h6M9 16h4" />
      </>
    ),
    packages: (
      <>
        <path d="M4 8l8-4 8 4-8 4-8-4z" />
        <path d="M4 8v8l8 4 8-4V8" />
        <path d="M12 12v8" />
      </>
    ),
    pos: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h8M8 13h3M14 13h2M8 16h2M13 16h3" />
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
    team: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-3-3.9" />
        <path d="M8 21v-2a4 4 0 0 1 8 0v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M19 8a3 3 0 1 1-2.2-2.9" />
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

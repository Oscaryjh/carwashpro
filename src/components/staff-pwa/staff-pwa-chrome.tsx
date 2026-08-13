"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { staffApiFetch } from "@/lib/staff-pwa/client";
import {
  buildStaffNavigation,
  type StaffNavigationIcon,
} from "@/lib/staff-pwa/navigation";

const authRoutes = new Set([
  "/staff/login",
  "/staff/verify",
  "/staff/select-workplace",
]);

export function StaffPwaChrome({ children, enabledModules }: { children: React.ReactNode; enabledModules: readonly string[] }) {
  const pathname = usePathname();
  const currentPath = pathname ?? "/staff";
  const showNavigation = !authRoutes.has(currentPath);
  const [liveModules, setLiveModules] = useState<readonly string[]>(enabledModules);
  const navigation = buildStaffNavigation(liveModules);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => setMoreOpen(false), [currentPath]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);
  useEffect(() => {
    let active = true;
    setLiveModules(enabledModules);
    if (!showNavigation) return () => { active = false; };

    void staffApiFetch<{ ok: true; enabledModules: string[] }>("/api/employee-auth/modules")
      .then((result) => {
        if (active) setLiveModules(result.enabledModules);
      })
      .catch(() => {
        // The page-level auth and module gates remain authoritative. A failed
        // navigation refresh must not broaden access beyond the server seed.
      });

    return () => { active = false; };
  }, [currentPath, enabledModules, showNavigation]);

  return (
    <div className="staff-pwa-shell">
      <OfflineBanner />
      <header className="staff-pwa-header">
        <Link aria-label="Tetamu Staff App home" className="staff-pwa-brand" href="/staff">
          <span aria-hidden="true">T</span>
          <strong>Tetamu<small>Staff App</small></strong>
        </Link>
        <PwaInstallButton />
      </header>
      <main className="staff-pwa-main">{children}</main>
      {showNavigation && moreOpen ? (
        <div className="staff-more-backdrop" role="presentation" onClick={() => setMoreOpen(false)}>
          <section aria-label="More Staff App sections" aria-modal="true" className="staff-more-sheet" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="staff-more-heading">
              <div><small>SELF-SERVICE</small><strong>More</strong></div>
              <button aria-label="Close more menu" onClick={() => setMoreOpen(false)} type="button">Close</button>
            </div>
            <div className="staff-more-links">
              {navigation.more.map((item) => (
                <Link aria-current={isActive(currentPath, item.href) ? "page" : undefined} href={item.href} key={item.href}>
                  <span aria-hidden="true"><StaffNavIcon name={item.icon} /></span>
                  <strong>{item.label}</strong>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {showNavigation ? (
        <nav aria-label="Staff navigation" className="staff-pwa-nav">
          {navigation.primary.map((item) => (
            <Link aria-current={isActive(currentPath, item.href) ? "page" : undefined} className={isActive(currentPath, item.href) ? "active" : ""} href={item.href} key={item.href}>
              <span aria-hidden="true"><StaffNavIcon name={item.icon} /></span>{item.label}
            </Link>
          ))}
          {navigation.more.length ? (
            <button
              aria-current={navigation.more.some((item) => isActive(currentPath, item.href)) ? "page" : undefined}
              aria-expanded={moreOpen}
              className={navigation.more.some((item) => isActive(currentPath, item.href)) ? "active" : ""}
              onClick={() => setMoreOpen((open) => !open)}
              type="button"
            >
              <span aria-hidden="true"><StaffNavIcon name="schedule" /></span>More
            </button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function StaffNavIcon({ name }: { name: StaffNavigationIcon }) {
  const paths: Record<StaffNavigationIcon, React.ReactNode> = {
    home: <><path d="m3.5 11 8.5-7 8.5 7" /><path d="M5.5 10v10h13V10M9.5 20v-6h5v6" /></>,
    attendance: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    leave: <><path d="M5 20c8 0 14-5 14-15C9 5 5 11 5 20Z" /><path d="M6 18c3-4 6-7 11-10" /></>,
    schedule: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3" /></>,
    timesheet: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    claims: <><path d="M7 3h10l3 3v15H4V3z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    commission: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.7-1.9-1-3.2-1-1.8 0-3 .8-3 2.1 0 3.2 6.1 1.6 6.1 4.9 0 1.3-1.2 2.1-3.2 2.1-1.5 0-2.8-.5-3.7-1.4M12 5.5v13" /></>,
    payslip: <><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.8-4.5 3.3-6.7 7.5-6.7s6.7 2.2 7.5 6.7" /></>,
  };
  return (
    <svg className="staff-nav-icon" fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return <div className="staff-pwa-offline" role="alert">Staff App requires a network connection. Connect to the internet and try again.</div>;
}

function isActive(currentPath: string, href: string) {
  if (href === "/staff") return currentPath === href;
  if (href === "/staff/profile") return currentPath === href || currentPath === "/staff/device";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

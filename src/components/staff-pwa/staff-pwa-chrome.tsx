"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import {
  clearStaffTenantClientState,
  StaffApiError,
  staffApiFetch,
} from "@/lib/staff-pwa/client";
import {
  buildStaffNavigation,
  type StaffNavigationIcon,
} from "@/lib/staff-pwa/navigation";
import type { EmployeeWorkplaceChoice } from "@/lib/staff-pwa/types";
import type { StaffAppAppearance } from "@/lib/staff-pwa/appearance-config";

const authRoutes = new Set([
  "/staff/login",
  "/staff/verify",
  "/staff/select-workplace",
]);

type StaffShellContextValue = {
  workplaces: readonly EmployeeWorkplaceChoice[];
  openWorkplaceSwitcher: () => void;
  logout: () => Promise<void>;
  setTaskNavigationHidden: (hidden: boolean) => void;
  switching: boolean;
};

const StaffShellContext = createContext<StaffShellContextValue | null>(null);

export function useStaffShell() {
  const value = useContext(StaffShellContext);
  if (!value) throw new Error("Staff shell is unavailable.");
  return value;
}

export function StaffPwaChrome({
  children,
  appearance,
  enabledModules,
  workplaces,
}: {
  children: React.ReactNode;
  appearance: StaffAppAppearance | null;
  enabledModules: readonly string[];
  workplaces: readonly EmployeeWorkplaceChoice[];
}) {
  const pathname = usePathname();
  const currentPath = pathname ?? "/staff";
  const showNavigation = !authRoutes.has(currentPath);
  const showBrandHeader = authRoutes.has(currentPath) || currentPath === "/staff";
  const shellRef = useRef<HTMLDivElement>(null);
  const [liveModules, setLiveModules] = useState<readonly string[]>(enabledModules);
  const navigation = buildStaffNavigation(liveModules);
  const [workplacesOpen, setWorkplacesOpen] = useState(false);
  const [taskNavigationHidden, setTaskNavigationHidden] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const currentWorkplace = workplaces.find((workplace) => workplace.current);

  useEffect(() => {
    setWorkplacesOpen(false);
    shellRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [currentPath]);
  useEffect(() => {
    if (!workplacesOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !switching) {
        setWorkplacesOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [switching, workplacesOpen]);
  useEffect(() => {
    let active = true;
    setLiveModules(enabledModules);
    if (!showNavigation) return () => { active = false; };

    void staffApiFetch<{ ok: true; enabledModules: string[] }>("/api/employee-auth/modules")
      .then((result) => {
        if (active) setLiveModules(result.enabledModules);
      })
      .catch(() => {
        // Page-level auth and module gates remain authoritative.
      });

    return () => { active = false; };
  }, [currentPath, enabledModules, showNavigation]);

  function openWorkplaceSwitcher() {
    setSwitchError("");
    setWorkplacesOpen(true);
  }

  async function switchWorkplace(membershipId: string) {
    if (switching || membershipId === currentWorkplace?.membershipId) return;
    setSwitching(true);
    setSwitchError("");
    try {
      await staffApiFetch<{ ok: true }>("/api/employee-auth/switch-workplace", {
        method: "POST",
        body: JSON.stringify({ membershipId }),
      });
      clearStaffTenantClientState();
      window.location.replace("/staff");
    } catch (caught) {
      setSwitching(false);
      if (caught instanceof StaffApiError && [
        "UNAUTHENTICATED",
        "SESSION_EXPIRED",
        "SESSION_REVOKED",
        "DEVICE_REVOKED",
        "EMPLOYEE_INACTIVE",
      ].includes(caught.code)) {
        clearStaffTenantClientState();
        window.location.replace("/staff/login?reason=session-expired");
        return;
      }
      setSwitchError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to switch workplace. Please try again.",
      );
    }
  }

  async function logout() {
    if (switching) return;
    setSwitching(true);
    try {
      await staffApiFetch<{ ok: true }>("/api/employee-auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // Local state is still cleared when an already-expired session cannot be revoked.
    } finally {
      clearStaffTenantClientState();
      window.location.replace("/staff/login?reason=logged-out");
    }
  }

  const shellValue: StaffShellContextValue = {
    workplaces,
    openWorkplaceSwitcher,
    logout,
    setTaskNavigationHidden,
    switching,
  };

  return (
    <StaffShellContext.Provider value={shellValue}>
      <div
        className={`staff-pwa-shell ${showNavigation ? "staff-app-shell" : "staff-auth-shell"}${taskNavigationHidden ? " staff-task-modal-open" : ""}`}
        ref={shellRef}
      >
        <OfflineBanner />
        {showBrandHeader ? (
          <header className="staff-pwa-header">
            <Link aria-label="Tetamu Staff App home" className="staff-pwa-brand" href="/staff">
              <span aria-hidden="true" className={appearance?.logoUrl ? "has-logo" : undefined}>
                {appearance?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={appearance.logoUrl} />
                ) : "T"}
              </span>
              <strong>Tetamu<small>Staff App</small></strong>
            </Link>
            {showNavigation && currentWorkplace ? (
              <button
                aria-label={workplaces.length > 1 ? "Switch workplace" : "Current workplace"}
                className="staff-current-workplace"
                disabled={workplaces.length < 2}
                onClick={openWorkplaceSwitcher}
                type="button"
              >
                <span>{currentWorkplace.businessName}</span>
                {normalizeLabel(currentWorkplace.primaryBranchName) !== normalizeLabel(currentWorkplace.businessName) ? (
                  <small>{currentWorkplace.primaryBranchName}</small>
                ) : null}
                {workplaces.length > 1 ? <b aria-hidden="true">Switch</b> : null}
              </button>
            ) : null}
            <PwaInstallButton />
          </header>
        ) : null}
        <main className="staff-pwa-main">{children}</main>

        {showNavigation && workplacesOpen ? (
          <div className="staff-more-backdrop staff-workplace-backdrop" role="presentation" onClick={() => !switching && setWorkplacesOpen(false)}>
            <section aria-label="Choose workplace" aria-modal="true" className="staff-more-sheet staff-workplace-sheet" onClick={(event) => event.stopPropagation()} role="dialog">
              <div className="staff-more-heading">
                <div><small>MY WORKPLACES</small><strong>Choose workplace</strong></div>
                <button disabled={switching} onClick={() => setWorkplacesOpen(false)} type="button">Close</button>
              </div>
              <p className="staff-workplace-help">Your Staff App will switch to the selected workplace.</p>
              {switchError ? <div className="staff-alert error" role="alert">{switchError}</div> : null}
              <div className="staff-workplace-options">
                {workplaces.map((workplace) => {
                  const showBranchName = normalizeLabel(workplace.primaryBranchName)
                    !== normalizeLabel(workplace.businessName);

                  return (
                    <button
                      aria-current={workplace.current ? "true" : undefined}
                      disabled={switching || workplace.current}
                      key={workplace.membershipId}
                      onClick={() => void switchWorkplace(workplace.membershipId)}
                      type="button"
                    >
                      <span>
                        <strong>{workplace.businessName}</strong>
                        {showBranchName ? <small>{workplace.primaryBranchName}</small> : null}
                      </span>
                      <b>{workplace.current ? "Current" : "Switch"}</b>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}

        {switching ? (
          <div aria-live="assertive" className="staff-switching-overlay" role="status">
            <span className="staff-spinner" aria-hidden="true" />
            <strong>Securing your workplace session…</strong>
            <small>Please wait. Do not close this page.</small>
          </div>
        ) : null}

        {showNavigation && !taskNavigationHidden ? (
          <nav aria-label="Staff navigation" className="staff-pwa-nav">
            {navigation.primary.map((item) => (
              <Link aria-current={isActive(currentPath, item) ? "page" : undefined} className={isActive(currentPath, item) ? "active" : ""} href={item.href} key={item.href}>
                <span aria-hidden="true"><StaffNavIcon name={item.icon} /></span>{item.label}
              </Link>
            ))}
            {navigation.more.map((item) => (
              <Link aria-current={isActive(currentPath, item) ? "page" : undefined} className={isActive(currentPath, item) ? "active" : ""} href={item.href} key={item.href}>
                <span aria-hidden="true"><StaffNavIcon name={item.icon} /></span>{item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </StaffShellContext.Provider>
  );
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-MY");
}

function StaffNavIcon({ name }: { name: StaffNavigationIcon }) {
  const paths: Record<StaffNavigationIcon, React.ReactNode> = {
    home: <><path d="m3.5 11 8.5-7 8.5 7" /><path d="M5.5 10v10h13V10M9.5 20v-6h5v6" /></>,
    attendance: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    requests: <><path d="M6 3h12v18H6z" /><path d="M9 3.5h6M9 9h6M9 13h6M9 17h4" /><path d="m4 9 1 1 2-2" /></>,
    pay: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /><circle cx="17" cy="15" r="1" /></>,
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
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</g>
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

function isActive(
  currentPath: string,
  item: { href: string; activePrefixes?: readonly string[] },
) {
  if (item.href === "/staff") return currentPath === item.href;
  if (item.href === "/staff/profile") return currentPath === item.href || currentPath === "/staff/device";
  const prefixes = item.activePrefixes ?? [item.href];
  return prefixes.some((prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`));
}

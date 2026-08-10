"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";

const authRoutes = new Set([
  "/staff/login",
  "/staff/verify",
  "/staff/select-workplace",
]);

export function StaffPwaChrome({ children, enabledModules }: { children: React.ReactNode; enabledModules: readonly string[] }) {
  const pathname = usePathname();
  const currentPath = pathname ?? "/staff";
  const showNavigation = !authRoutes.has(currentPath);
  const hrEnabled = enabledModules.includes("HR");
  const payrollEnabled = enabledModules.includes("PAYROLL");
  const claimsEnabled = enabledModules.includes("CLAIMS");

  return (
    <div className="staff-pwa-shell">
      <OfflineBanner />
      <header className="staff-pwa-header">
        <Link aria-label="Tetamu Attendance home" className="staff-pwa-brand" href="/staff">
          <span aria-hidden="true">T</span>
          <strong>
            Tetamu
            <small>Attendance</small>
          </strong>
        </Link>
        <PwaInstallButton />
      </header>
      <main className="staff-pwa-main">{children}</main>
      {showNavigation ? (
        <nav aria-label="Staff navigation" className="staff-pwa-nav">
          {hrEnabled ? <Link className={currentPath === "/staff" ? "active" : ""} href="/staff">
            <span aria-hidden="true">⌂</span>
            Today
          </Link> : null}
          {hrEnabled ? <Link
            className={currentPath === "/staff/history" ? "active" : ""}
            href="/staff/history"
          >
            <span aria-hidden="true">◷</span>
            History
          </Link> : null}
          {claimsEnabled ? <Link
            className={currentPath === "/staff/claims" ? "active" : ""}
            href="/staff/claims"
          >
            <span aria-hidden="true">$</span>
            Claims
          </Link> : null}
          {hrEnabled ? <Link
            className={currentPath === "/staff/timesheet" ? "active" : ""}
            href="/staff/timesheet"
          >
            <span aria-hidden="true">▤</span>
            Timesheet
          </Link> : null}
          {hrEnabled ? <Link
            className={currentPath === "/staff/leave" ? "active" : ""}
            href="/staff/leave"
          >
            <span aria-hidden="true">◇</span>
            Leave
          </Link> : null}
          {payrollEnabled ? <Link
            className={currentPath.startsWith("/staff/payslips") ? "active" : ""}
            href="/staff/payslips"
          >
            <span aria-hidden="true">▤</span>
            Payslips
          </Link> : null}
          <Link
            className={
              currentPath === "/staff/profile" || currentPath === "/staff/device"
                ? "active"
                : ""
            }
            href="/staff/profile"
          >
            <span aria-hidden="true">○</span>
            Profile
          </Link>
        </nav>
      ) : null}
    </div>
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

  if (online) {
    return null;
  }

  return (
    <div className="staff-pwa-offline" role="alert">
      Attendance requires a network connection. Connect to the internet and try again.
    </div>
  );
}

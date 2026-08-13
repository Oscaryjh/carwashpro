"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./hr-payroll-workspace.module.css";

export type HrPayrollWorkspaceItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: HrPayrollWorkspaceIcon;
  exact?: boolean;
  activePrefixes?: readonly string[];
};

export type HrPayrollWorkspaceIcon =
  | "people"
  | "approvals"
  | "attendance"
  | "roster"
  | "leave"
  | "claims"
  | "commission"
  | "payroll"
  | "overview"
  | "runs"
  | "payments"
  | "statutory"
  | "settings"
  | "resolution"
  | "timesheet"
  | "evidence";

export function HrPayrollWorkspaceNav({
  items,
  label,
  variant = "primary",
}: {
  items: readonly HrPayrollWorkspaceItem[];
  label: string;
  variant?: "primary" | "secondary";
}) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label={label}
      className={variant === "primary" ? styles.primaryNav : styles.secondaryNav}
    >
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? styles.activeLink : undefined}
            href={item.href}
            key={item.href}
            title={item.label}
          >
            <WorkspaceIcon name={item.icon} />
            <span>{item.shortLabel ?? item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string, item: HrPayrollWorkspaceItem) {
  if (item.activePrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function WorkspaceIcon({ name }: { name: HrPayrollWorkspaceIcon }) {
  const paths: Record<HrPayrollWorkspaceIcon, ReactNode> = {
    people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 19c.6-3.3 2.4-5 5.5-5s4.9 1.7 5.5 5M14 15c2.8-.6 5 .7 6 4" /></>,
    approvals: <><path d="M7 3h10v4H7z" /><path d="M5 5v16h14V5M8 12l2.5 2.5L16 9" /></>,
    attendance: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    roster: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3M8 17h3" /></>,
    leave: <><path d="M5 20c8 0 14-5 14-15C9 5 5 11 5 20Z" /><path d="M6 18c3-4 6-7 11-10" /></>,
    claims: <><path d="M7 3h10l3 3v15H4V3z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    commission: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.7-1.9-1-3.2-1-1.8 0-3 .8-3 2.1 0 3.2 6.1 1.6 6.1 4.9 0 1.3-1.2 2.1-3.2 2.1-1.5 0-2.8-.5-3.7-1.4M12 5.5v13" /></>,
    payroll: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10h10M7 14h4M15 14h2" /></>,
    overview: <><path d="M4 19V9M10 19V5M16 19v-7M3 19h18" /></>,
    runs: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2" /></>,
    payments: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>,
    statutory: <><path d="M12 3 4 7v5c0 5 3.2 8 8 9 4.8-1 8-4 8-9V7l-8-4Z" /><path d="m8.5 12 2.3 2.3 4.7-5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 14.5V9.5l-2-.7-.7-1.7.9-1.9-3.5-2-1.4 1.5h-1.8L9.1 3.2l-3.5 2 .9 1.9-.7 1.7-2 .7v5l2 .7.7 1.7-.9 1.9 3.5 2 1.4-1.5h1.8l1.4 1.5 3.5-2-.9-1.9.7-1.7 2-.7Z" /></>,
    resolution: <><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h5M8 17h3" /><path d="m14 16 1.5 1.5L19 14" /></>,
    timesheet: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    evidence: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 11h6M9 15h6" /></>,
  };

  return (
    <svg aria-hidden="true" className={styles.icon} fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        {paths[name]}
      </g>
    </svg>
  );
}

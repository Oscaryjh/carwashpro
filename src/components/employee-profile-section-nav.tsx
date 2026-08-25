"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type {
  EmployeeProfileLegacySection,
  EmployeeProfileSection,
} from "@/lib/team/employee-profile-tabs";
import styles from "./employee-profile-shell.module.css";

type NavigationItem = {
  description: string;
  key: EmployeeProfileSection | EmployeeProfileLegacySection;
  label: string;
  group: "Employee 360";
};

const profileGroups = ["Employee 360"] as const;

export function EmployeeProfileSectionNav({
  activeSection,
  items,
  personId,
  privacyNote,
}: {
  activeSection: EmployeeProfileSection;
  items: readonly NavigationItem[];
  personId: string;
  privacyNote: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const activeLink = scroller?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );

    if (!scroller || !activeLink) return;

    const frame = window.requestAnimationFrame(() => {
      activeLink.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSection]);

  const visibleGroups = profileGroups
    .map((group) => ({
      group,
      tabs: items.filter((tab) => tab.group === group),
    }))
    .filter((item) => item.tabs.length > 0);

  return (
    <div className={styles.profileRail} ref={scrollerRef}>
      <nav aria-label="Employee profile sections" className={styles.tabs}>
        {visibleGroups.map(({ group, tabs }) => (
          <div className={styles.tabGroup} key={group}>
            <span className={styles.tabGroupLabel}>{group}</span>
            <div className={styles.tabGroupLinks}>
              {tabs.map((tab) => (
                <Link
                  aria-current={
                    tab.key === activeSection ? "page" : undefined
                  }
                  className={
                    tab.key === activeSection ? styles.activeTab : undefined
                  }
                  href={`/team/people/${personId}?section=${tab.key}`}
                  key={tab.key}
                >
                  <span aria-hidden="true" className={styles.tabIcon}>
                    {sectionIcon(tab.key)}
                  </span>
                        <span>
                          <strong>{tab.label}</strong>
                          <small>{tab.description}</small>
                        </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        </nav>
        <p className={styles.privacyNote}>{privacyNote}</p>
      </div>
  );
}

function sectionIcon(
  section: EmployeeProfileSection | EmployeeProfileLegacySection,
) {
  const icons: Record<
    EmployeeProfileSection | EmployeeProfileLegacySection,
    string
  > = {
    overview: "◉",
    work: "◇",
    time: "◷",
    compensation: "$",
    access: "⌁",
    attendance: "◷",
    leave: "◒",
    claims: "$",
    commission: "%",
    payroll: "$",
    statutory: "§",
  };
  return icons[section];
}

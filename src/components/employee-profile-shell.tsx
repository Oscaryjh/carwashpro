import Link from "next/link";
import type { ReactNode } from "react";
import {
  EmployeeAvatarUpload,
  type EmployeeAvatarAction,
} from "@/components/employee-avatar-upload";
import {
  employeeProfileTabs,
  type EmployeeProfileSection,
} from "@/lib/team/employee-profile-tabs";
import styles from "./employee-profile-shell.module.css";

type VisibleTab = (typeof employeeProfileTabs)[number];
const profileGroups = ["Summary", "Work", "Pay & compliance", "Records"] as const;

export type EmployeeProfileShellPerson = {
  id: string;
  avatarUrl: string | null;
  fullName: string;
  employeeCode: string | null;
  employmentType: string | null;
  status: string;
  primaryBranchName: string | null;
  linked: boolean;
};

export function EmployeeProfileShell({
  activeSection,
  avatarAction,
  authorized,
  person,
  profileLabel,
  sectionContent,
  visibleTabs,
}: {
  activeSection: EmployeeProfileSection;
  avatarAction?: EmployeeAvatarAction;
  authorized: boolean;
  person: EmployeeProfileShellPerson;
  profileLabel: "People" | "People & HR";
  sectionContent?: ReactNode;
  visibleTabs: readonly VisibleTab[];
}) {
  const activeTab = employeeProfileTabs.find(
    (tab) => tab.key === activeSection,
  );
  const visibleGroups = profileGroups
    .map((group) => ({
      group,
      tabs: visibleTabs.filter((tab) => tab.group === group),
    }))
    .filter((item) => item.tabs.length > 0);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <EmployeeAvatarUpload
            action={avatarAction}
            avatarUrl={person.avatarUrl}
            fullName={person.fullName}
          />
          <div className={styles.identityCopy}>
            <h1>{person.fullName}</h1>
            <div className={styles.meta}>
              <span className={styles.employeeCode}>
                {person.employeeCode ??
                  (profileLabel === "People" ? "Core staff" : "Employment not linked")}
              </span>
              {person.employmentType ? (
                <span>{formatEnum(person.employmentType)}</span>
              ) : null}
              <span>{person.primaryBranchName ?? "No primary branch"}</span>
              <strong data-status={person.status.toLowerCase()}>
                {formatEnum(person.status)}
              </strong>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.profileRail}>
          <nav aria-label="Employee profile sections" className={styles.tabs}>
            {visibleGroups.map(({ group, tabs }) => (
              <div className={styles.tabGroup} key={group}>
                <span className={styles.tabGroupLabel}>{group}</span>
                <div className={styles.tabGroupLinks}>
                  {tabs.map((tab) => (
                    <Link
                      aria-current={tab.key === activeSection ? "page" : undefined}
                      className={tab.key === activeSection ? styles.activeTab : undefined}
                      href={`/team/people/${person.id}?section=${tab.key}`}
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
          <p className={styles.privacyNote}>
            Sensitive payroll and bank details appear only with permission. Bank
            account numbers stay masked outside the secure edit screen.
          </p>
        </aside>

        <div className={styles.profileMain}>
          {!authorized ? (
            <ProfileState
              eyebrow="Access denied"
              title="You do not have permission to view this section"
              description="This employee exists inside your authorized business scope, but this section requires an additional capability."
              tone="denied"
            />
          ) : sectionContent ? (
            sectionContent
          ) : !person.linked ? (
            <ProfileState
              eyebrow="Profile incomplete"
              title="Employment profile is not linked"
              description="This team member can remain in People, but an Employee membership must be linked before profile sections can show employment data."
              tone="empty"
            />
          ) : (
            <ProfileState
              eyebrow={activeTab?.label ?? "Employee profile"}
              title={sectionTitle(activeSection)}
              description={sectionDescription()}
              tone="ready"
            />
          )}
        </div>
      </div>
    </main>
  );
}

function sectionIcon(section: EmployeeProfileSection) {
  const icons: Record<EmployeeProfileSection, string> = {
    overview: "◉",
    personal: "◇",
    employment: "▣",
    attendance: "◷",
    leave: "◒",
    claims: "$",
    payroll: "▤",
    statutory: "§",
    documents: "▧",
    activity: "↻",
  };
  return icons[section];
}

function ProfileState({
  description,
  eyebrow,
  title,
  tone,
}: {
  description: string;
  eyebrow: string;
  title: string;
  tone: "denied" | "empty" | "ready";
}) {
  return (
    <section className={styles.state} data-tone={tone}>
      <span aria-hidden="true" className={styles.stateIcon}>
        {tone === "denied" ? "!" : tone === "empty" ? "–" : "✓"}
      </span>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}

function sectionDescription() {
  return "This section is planned for a later phase. No section records are loaded yet.";
}

function sectionTitle(section: EmployeeProfileSection) {
  if (section === "documents") {
    return "Documents are not available yet";
  }
  if (section === "activity") {
    return "Activity is not available yet";
  }
  return "Profile section is not available yet";
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

import Link from "next/link";
import {
  employeeProfileTabs,
  type EmployeeProfileSection,
} from "@/lib/team/employee-profile-tabs";
import styles from "./employee-profile-shell.module.css";

type VisibleTab = (typeof employeeProfileTabs)[number];

export type EmployeeProfileShellPerson = {
  id: string;
  fullName: string;
  employeeCode: string | null;
  employmentType: string | null;
  status: string;
  primaryBranchName: string | null;
  linked: boolean;
};

export function EmployeeProfileShell({
  activeSection,
  authorized,
  person,
  visibleTabs,
}: {
  activeSection: EmployeeProfileSection;
  authorized: boolean;
  person: EmployeeProfileShellPerson;
  visibleTabs: readonly VisibleTab[];
}) {
  const activeTab = employeeProfileTabs.find(
    (tab) => tab.key === activeSection,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span aria-hidden="true" className={styles.avatar}>
            {getInitials(person.fullName)}
          </span>
          <div>
            <p className={styles.eyebrow}>HR &amp; Payroll / Employee Profile</p>
            <h1>{person.fullName}</h1>
            <div className={styles.meta}>
              <span>{person.employeeCode ?? "Employment not linked"}</span>
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
        <Link className={styles.backLink} href="/team?section=people">
          Back to People
        </Link>
      </header>

      <nav aria-label="Employee profile sections" className={styles.tabs}>
        {visibleTabs.map((tab) => (
          <Link
            aria-current={tab.key === activeSection ? "page" : undefined}
            className={tab.key === activeSection ? styles.activeTab : undefined}
            href={`/team/people/${person.id}?section=${tab.key}`}
            key={tab.key}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {!authorized ? (
        <ProfileState
          eyebrow="Access denied"
          title="You do not have permission to view this section"
          description="This employee exists inside your authorized business scope, but this section requires an additional capability."
          tone="denied"
        />
      ) : !person.linked ? (
        <ProfileState
          eyebrow="Profile incomplete"
          title="Employment profile is not linked"
          description="This team member can remain in People, but an Employee membership must be linked before profile sections can show employment data."
          tone="empty"
        />
      ) : (
        <ProfileState
          eyebrow={activeTab?.phase ?? "Future phase"}
          title={`${activeTab?.label ?? "Profile"} shell is ready`}
          description={sectionDescription(activeSection)}
          tone="ready"
        />
      )}
    </main>
  );
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

function sectionDescription(section: EmployeeProfileSection) {
  if (["overview", "personal", "employment", "attendance"].includes(section)) {
    return "Read-only aggregated content will be connected in Phase 2. This shell does not query that section's records yet.";
  }
  if (section === "payroll") {
    return "Salary, bank and statutory data will be loaded separately by capability in Phase 3. No sensitive payroll data is queried in this shell.";
  }
  return "This section is reserved for a later phase. No section records are queried yet.";
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "E"
  );
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

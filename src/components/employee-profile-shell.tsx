import Link from "next/link";
import type { ReactNode } from "react";
import {
  EmployeeAvatarUpload,
  type EmployeeAvatarAction,
} from "@/components/employee-avatar-upload";
import { EmployeeProfileSectionNav } from "@/components/employee-profile-section-nav";
import {
  employeeProfileTabs,
  type EmployeeProfileNavigationTab,
  type EmployeeProfileSection,
} from "@/lib/team/employee-profile-tabs";
import styles from "./employee-profile-shell.module.css";

type VisibleTab = EmployeeProfileNavigationTab;

export type EmployeeProfileShellPerson = {
  id: string;
  avatarUrl: string | null;
  fullName: string;
  employeeCode: string | null;
  position: string | null;
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
  editHref,
  notice,
}: {
  activeSection: EmployeeProfileSection;
  avatarAction?: EmployeeAvatarAction;
  authorized: boolean;
  person: EmployeeProfileShellPerson;
  profileLabel: "People" | "People & HR";
  sectionContent?: ReactNode;
  visibleTabs: readonly VisibleTab[];
  editHref?: string;
  notice?: { message: string; tone: "error" | "success" } | null;
}) {
  const activeTab = employeeProfileTabs.find(
    (tab) => tab.key === activeSection,
  );
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
                  (profileLabel === "People"
                    ? "Core staff"
                    : "Employment not linked")}
              </span>
              {person.position ? <span>{person.position}</span> : null}
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
        {editHref ? (
          <Link className={styles.editProfileAction} href={editHref}>
            <span aria-hidden="true">&#9998;</span>
            Edit details
          </Link>
        ) : null}
      </header>

      {notice ? (
        <div className={styles.profileNotice} data-tone={notice.tone}>
          {notice.message}
        </div>
      ) : null}

      <div className={styles.workspace}>
        <EmployeeProfileSectionNav
          activeSection={activeSection}
          items={visibleTabs.map(({ description, group, key, label }) => ({
            description,
            group,
            key,
            label,
          }))}
          personId={person.id}
          privacyNote="Sensitive payroll and bank details appear only with permission. Bank account numbers stay masked outside the secure edit screen."
        />

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
  return `${employeeProfileTabs.find((tab) => tab.key === section)?.label ?? "Profile"} is not available`;
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

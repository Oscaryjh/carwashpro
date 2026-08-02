import type { getEmployeeProfilePersonal } from "@/lib/team/employee-profile-read";
import styles from "./employee-profile-shell.module.css";

type PersonalData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfilePersonal>>
>;

export function EmployeeProfilePersonal({ data }: { data: PersonalData }) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Personal</p>
          <h2>Personal details</h2>
          <p>
            Read-only basic and contact details already stored in the employee
            record. No additional sensitive fields are loaded.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Basic information</p>
              <h3>Employee details</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <PersonalDetail label="Full name" value={data.fullName} />
            <PersonalDetail
              label="Date of birth"
              value={formatDateOfBirth(data.dateOfBirth)}
            />
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Contact</p>
              <h3>Contact details</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <PersonalDetail
              label="Phone number"
              value={data.phoneNumber || "Not recorded"}
            />
            <PersonalDetail
              label="Linked POS email"
              value={data.staffUser?.email || "Not linked"}
            />
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Identity</p>
              <h3>Identity information</h3>
            </div>
          </div>
          <PersonalEmpty
            title="Not available in this phase"
            description="This information is not available from the Personal read model."
          />
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Additional information</p>
              <h3>Other personal details</h3>
            </div>
          </div>
          <PersonalEmpty
            title="Not stored in the current employee record"
            description="No additional personal information is stored in the current employee record."
          />
        </section>
      </div>
    </div>
  );
}

function PersonalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PersonalEmpty({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className={styles.profileEmpty}>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function formatDateOfBirth(value: Date | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}

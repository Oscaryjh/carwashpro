import type { getEmployeeProfilePersonal } from "@/lib/team/employee-profile-read";
import styles from "./employee-profile-shell.module.css";

type PersonalData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfilePersonal>>
>;

type CoreStaffData = {
  appointmentBookable: boolean;
  branch: { name: string } | null;
  email: string | null;
  loginEnabled: boolean;
  name: string;
  staffRoleProfile: { name: string } | null;
  status: string;
  whatsappPhone: string | null;
  _count: { serviceStaffAssignments: number };
};

export function EmployeeProfileCoreStaffOverview({ data }: { data: CoreStaffData }) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Overview</p>
          <h2>Team member overview</h2>
          <p>People Core keeps staff assignment, branch, role and login available without HR.</p>
        </div>
        <span className={styles.scopeBadge}>People Core</span>
      </section>
      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Operational assignment</p><h3>Staff setup</h3></div></div>
          <div className={styles.detailList}>
            <PersonalDetail label="Branch" value={data.branch?.name ?? "Not assigned"} />
            <PersonalDetail label="Role" value={data.staffRoleProfile?.name ?? "Custom access"} />
            <PersonalDetail label="Services" value={`${data._count.serviceStaffAssignments} assigned`} />
            <PersonalDetail label="Provides services" value={data.appointmentBookable ? "Yes" : "No"} />
          </div>
        </section>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Access</p><h3>Account state</h3></div></div>
          <div className={styles.detailList}>
            <PersonalDetail label="Staff status" value={formatCoreStatus(data.status)} />
            <PersonalDetail label="Back-office login" value={data.loginEnabled ? "Enabled" : "Not enabled"} />
            <PersonalDetail label="Login email" value={data.email ?? "Not configured"} />
          </div>
        </section>
      </div>
    </div>
  );
}

export function EmployeeProfileCoreStaffPersonal({ data }: { data: CoreStaffData }) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div><p className={styles.eyebrow}>Personal</p><h2>Contact details</h2><p>Only operational People Core contact fields are loaded.</p></div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>
      <section className={styles.profilePanel}>
        <div className={styles.detailList}>
          <PersonalDetail label="Full name" value={data.name} />
          <PersonalDetail label="Phone number" value={data.whatsappPhone ?? "Not recorded"} />
          <PersonalDetail label="Login email" value={data.email ?? "Not configured"} />
        </div>
      </section>
    </div>
  );
}

export function EmployeeProfilePersonal({ data }: { data: PersonalData }) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Personal</p>
          <h2>Contact details</h2>
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
              <h3>Team member</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <PersonalDetail label="Full name" value={data.fullName} />
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

function formatCoreStatus(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

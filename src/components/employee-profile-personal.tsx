import styles from "./employee-profile-shell.module.css";

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

export function EmployeeProfileCoreStaffOverview({
  data,
}: {
  data: CoreStaffData;
}) {
  return (
    <div className={styles.sectionContent}>
      <div className={styles.profileGrid}>
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
              value={data.whatsappPhone ?? "Not recorded"}
            />
            <PersonalDetail
              label="Login email"
              value={data.email ?? "Not configured"}
            />
          </div>
        </section>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Work</p>
              <h3>Work setup</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <PersonalDetail
              label="Access role"
              value={data.staffRoleProfile?.name ?? "Custom access"}
            />
            <PersonalDetail
              label="Assigned services"
              value={`${data._count.serviceStaffAssignments} assigned`}
            />
            <PersonalDetail
              label="Service booking"
              value={data.appointmentBookable ? "Enabled" : "Not enabled"}
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

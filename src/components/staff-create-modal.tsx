import { CatalogFormModal } from "@/components/catalog-form-modal";
import { StaffForm } from "@/components/staff-form";
import type { User } from "@prisma/client";

type StaffBranch = {
  id: string;
  name: string;
};

type StaffCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: StaffBranch[];
  industryType?: string;
  roleProfiles: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  staffLevels: Array<{ id: string; name: string }>;
};

export function StaffCreateModal({
  action,
  branches,
  industryType,
  roleProfiles,
  services,
  staffLevels,
}: StaffCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="Add team member"
      closePath="/team?section=people"
      eyebrow="PEOPLE"
      title="Add team member"
      wide
    >
      <div className="staff-create-modal-content">
        {!branches.length ? (
          <div className="warning">
            No active branch is available. Contact the platform administrator before
            adding staff.
          </div>
        ) : null}
        <StaffForm
          action={action}
          branches={branches}
          industryType={industryType}
          roleProfiles={roleProfiles}
          services={services}
          staffLevels={staffLevels}
          submitLabel="Add team member"
        />
      </div>
    </CatalogFormModal>
  );
}

type StaffEditModalProps = StaffCreateModalProps & {
  assignedBranchIds: string[];
  employeeProfile?: {
    attendanceEnabled: boolean;
    canClockInBranchIds: string[];
    employeeCode: string;
    employmentType: string;
    payBasis: "MONTHLY" | "DAILY" | "HOURLY";
    baseSalary: string | null;
    normalWorkMinutesPerDay: number | null;
    targetBreakMinutes: number | null;
    joinedAt: string;
    primaryBranchId: string;
    status: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  } | null;
  selectedServiceIds?: string[];
  staff: User;
};

export function StaffEditModal({
  action,
  assignedBranchIds,
  branches,
  employeeProfile,
  industryType,
  roleProfiles,
  selectedServiceIds,
  services,
  staff,
  staffLevels,
}: StaffEditModalProps) {
  return (
    <CatalogFormModal
      ariaLabel={`Edit ${staff.name}`}
      closePath="/team?section=people"
      eyebrow="PEOPLE"
      modalClassName="staff-edit-modal"
      title="Edit team member"
      wide
    >
      <div className="staff-create-modal-content">
        <div className="staff-edit-modal-summary">
          <span>{staff.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{staff.name}</strong>
            <small>{staff.whatsappPhone || staff.email || "No contact details"}</small>
          </div>
          <em
            className={
              (employeeProfile?.status ?? staff.status) === "ACTIVE" ||
              (employeeProfile?.status ?? staff.status) === "active"
                ? "status"
                : "status status-neutral"
            }
          >
            {employeeProfile?.status ?? staff.status}
          </em>
        </div>
        {!employeeProfile ? (
          <div className="staff-legacy-edit-banner">
            <span aria-hidden="true">i</span>
            <div>
              <strong>Staff profile only</strong>
              <small>
                Enable Create employment profile below to add pay, standard work
                hours, breaks and Attendance access to this Staff member.
              </small>
            </div>
          </div>
        ) : null}
        {!branches.length ? (
          <div className="warning">No active branch is available for staff assignment.</div>
        ) : null}
        <StaffForm
          action={action}
          assignedBranchIds={assignedBranchIds}
          branches={branches}
          employeeProfile={employeeProfile}
          industryType={industryType}
          roleProfiles={roleProfiles}
          selectedServiceIds={selectedServiceIds}
          services={services}
          staff={staff}
          staffLevels={staffLevels}
          submitLabel="Save changes"
        />
      </div>
    </CatalogFormModal>
  );
}

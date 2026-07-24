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
};

export function StaffCreateModal({
  action,
  branches,
  industryType,
}: StaffCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="Create staff"
      closePath="/team?section=staff"
      eyebrow="TEAM"
      title="Create staff"
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
          submitLabel="Create staff"
        />
      </div>
    </CatalogFormModal>
  );
}

type StaffEditModalProps = StaffCreateModalProps & {
  assignedBranchIds: string[];
  staff: User;
};

export function StaffEditModal({
  action,
  assignedBranchIds,
  branches,
  industryType,
  staff,
}: StaffEditModalProps) {
  return (
    <CatalogFormModal
      ariaLabel={`Edit ${staff.name}`}
      closePath="/team?section=staff"
      eyebrow="TEAM"
      modalClassName="staff-edit-modal"
      title="Edit staff"
      wide
    >
      <div className="staff-create-modal-content">
        <div className="staff-edit-modal-summary">
          <span>{staff.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{staff.name}</strong>
            <small>{staff.whatsappPhone || staff.email || "No contact details"}</small>
          </div>
          <em className={staff.status === "active" ? "status" : "status status-neutral"}>
            {staff.status}
          </em>
        </div>
        {!branches.length ? (
          <div className="warning">No active branch is available for staff assignment.</div>
        ) : null}
        <StaffForm
          action={action}
          assignedBranchIds={assignedBranchIds}
          branches={branches}
          industryType={industryType}
          staff={staff}
          submitLabel="Save changes"
        />
      </div>
    </CatalogFormModal>
  );
}

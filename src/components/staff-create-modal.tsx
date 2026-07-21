import { CatalogFormModal } from "@/components/catalog-form-modal";
import { StaffForm } from "@/components/staff-form";

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
      closePath="/team"
      eyebrow="TEAM & PERMISSIONS"
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

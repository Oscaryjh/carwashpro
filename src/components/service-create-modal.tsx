import type { ServiceCategory } from "@prisma/client";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import { ServiceForm } from "@/components/service-form";
import type { BranchOption } from "@/lib/branches";

type ServiceCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  categories: Pick<ServiceCategory, "id" | "name" | "status">[];
  isSalonBusiness: boolean;
  staffOptions: Array<{
    branchName: string | null;
    id: string;
    name: string;
    role: string;
  }>;
};

export function ServiceCreateModal({
  action,
  branches,
  categories,
  isSalonBusiness,
  staffOptions,
}: ServiceCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="New service"
      closePath="/services"
      eyebrow="SERVICE CATALOG"
      title="New service"
      wide
    >
      <ServiceForm
        action={action}
        branches={branches}
        categories={categories}
        isSalonBusiness={isSalonBusiness}
        staffOptions={staffOptions}
        submitLabel="Create service"
      />
    </CatalogFormModal>
  );
}

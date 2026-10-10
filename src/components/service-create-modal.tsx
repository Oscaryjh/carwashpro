import type { ServiceCategory } from "@prisma/client";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import { ServiceForm } from "@/components/service-form";
import type { BranchOption } from "@/lib/branches";
import type { OutletPresentation } from "@/lib/outlet-ui-context";

type ServiceCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  outlet?: OutletPresentation;
  branches: BranchOption[];
  categories: Pick<ServiceCategory, "id" | "name" | "status">[];
  isSalonBusiness: boolean;
  companySstRate?: number | null;
  staffOptions: Array<{
    branchName: string | null;
    id: string;
    name: string;
    role: string;
  }>;
};

export function ServiceCreateModal({
  action,
  outlet,
  branches,
  categories,
  isSalonBusiness,
  companySstRate,
  staffOptions,
}: ServiceCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="New service"
      closePath="/services"
      eyebrow="SERVICE CATALOG"
      title="New service"
      modalClassName="service-create-modal"
      wide
    >
      <ServiceForm
        outlet={outlet}
        modalLayout
        action={action}
        branches={branches}
        categories={categories}
        isSalonBusiness={isSalonBusiness}
        companySstRate={companySstRate}
        staffOptions={staffOptions}
        submitLabel="Create service"
      />
    </CatalogFormModal>
  );
}

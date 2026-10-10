import type { PackageCategory, Service, ServiceCategory } from "@prisma/client";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import { PackageForm } from "@/components/package-form";
import type { BranchOption } from "@/lib/branches";
import type { OutletPresentation } from "@/lib/outlet-ui-context";

type PackageCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  outlet?: OutletPresentation;
  branches: BranchOption[];
  categories: Pick<PackageCategory, "id" | "name" | "status">[];
  isSalonBusiness: boolean;
  services: Array<
    Pick<Service, "id" | "name" | "category" | "price"> & {
      serviceCategory?: Pick<ServiceCategory, "name"> | null;
    }
  >;
};

export function PackageCreateModal({
  action,
  outlet,
  branches,
  categories,
  isSalonBusiness,
  services,
}: PackageCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="New package"
      closePath="/packages"
      eyebrow="PACKAGE CATALOG"
      title="New package"
      wide
    >
      <PackageForm
        outlet={outlet}
        action={action}
        branches={branches}
        categories={categories}
        isSalonBusiness={isSalonBusiness}
        services={services}
        submitLabel="Create package"
      />
    </CatalogFormModal>
  );
}

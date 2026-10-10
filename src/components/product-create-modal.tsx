import type { ProductCategory } from "@prisma/client";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import { ProductForm } from "@/components/product-form";
import type { BranchOption } from "@/lib/branches";
import type { OutletPresentation } from "@/lib/outlet-ui-context";

type ProductCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  categories: Pick<ProductCategory, "id" | "name" | "status">[];
  inventoryEnabled: boolean;
  companySstRate?: number | null;
  outlet?: OutletPresentation;
};

export function ProductCreateModal({ action, branches, categories, inventoryEnabled, companySstRate, outlet }: ProductCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="New product"
      closePath="/products"
      eyebrow="PRODUCT CATALOG"
      title="New product"
      modalClassName="product-create-layout"
    >
      <ProductForm
        action={action}
        branches={branches}
        categories={categories}
        inventoryEnabled={inventoryEnabled}
        modalLayout
        companySstRate={companySstRate}
        outlet={outlet}
        returnPath="/products"
        submitLabel="Create product"
      />
    </CatalogFormModal>
  );
}

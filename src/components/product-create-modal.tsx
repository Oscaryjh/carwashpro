import type { ProductCategory } from "@prisma/client";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import { ProductForm } from "@/components/product-form";
import type { BranchOption } from "@/lib/branches";

type ProductCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  categories: Pick<ProductCategory, "id" | "name" | "status">[];
};

export function ProductCreateModal({ action, branches, categories }: ProductCreateModalProps) {
  return (
    <CatalogFormModal
      ariaLabel="New product"
      closePath="/products"
      eyebrow="PRODUCT CATALOG"
      title="New product"
    >
      <ProductForm
        action={action}
        branches={branches}
        categories={categories}
        returnPath="/products"
        submitLabel="Create product"
      />
    </CatalogFormModal>
  );
}

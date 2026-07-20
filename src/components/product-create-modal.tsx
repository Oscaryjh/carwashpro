"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { BranchOption } from "@/lib/branches";
import type { ProductCategory } from "@prisma/client";
import { ProductForm } from "@/components/product-form";

type ProductCreateModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  categories: Pick<ProductCategory, "id" | "name" | "status">[];
  onClose?: () => void;
};

export function ProductCreateModal({ action, branches, categories, onClose: onCloseProp }: ProductCreateModalProps) {
  const router = useRouter();
  const fallbackClose = useCallback(() => router.push("/products"), [router]);
  const onClose = onCloseProp ?? fallbackClose;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="product-create-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section aria-labelledby="product-create-title" aria-modal="true" className="product-create-modal" role="dialog">
        <header className="product-create-modal-header">
          <button aria-label="Close new product" className="product-create-modal-close" onClick={onClose} type="button">×</button>
          <div>
            <p>PRODUCT CATALOG</p>
            <h2 id="product-create-title">New product</h2>
          </div>
          <span aria-hidden="true" className="product-create-modal-mark">＋</span>
        </header>
        <div className="product-create-modal-body">
          <ProductForm action={action} branches={branches} categories={categories} returnPath="/products" submitLabel="Create product" />
        </div>
      </section>
    </div>
  );
}

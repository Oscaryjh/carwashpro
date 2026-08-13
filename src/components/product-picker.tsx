"use client";

import { useMemo, useState } from "react";
import type { ProductSaleOption } from "@/components/product-sale-form";

type ProductPickerProps = {
  branchId: string;
  initiallyOpen?: boolean;
  onCancel?: () => void;
  onSelect: (productId: string) => void;
  products: ProductSaleOption[];
  selectedProductId: string;
};

export function ProductPicker({
  branchId,
  initiallyOpen = false,
  onCancel,
  onSelect,
  products,
  selectedProductId,
}: ProductPickerProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const selectedProduct = products.find((product) => product.id === selectedProductId);

  const categories = useMemo(() => {
    const values = products
      .map((product) => product.category?.trim())
      .filter((value): value is string => Boolean(value));

    return ["All", ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory = category === "All" || (product.category ?? "") === category;
      const searchable = [product.name, product.sku ?? "", product.category ?? ""]
        .join(" ")
        .toLowerCase();

      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [category, products, query]);

  function resetPicker() {
    setIsOpen(false);
    setQuery("");
    setCategory("All");
  }

  function cancelPicker() {
    resetPicker();
    onCancel?.();
  }

  function chooseProduct(productId: string) {
    onSelect(productId);
    resetPicker();
  }

  return (
    <>
      <button
        className="product-sale-selection"
        onClick={() => setIsOpen(true)}
        title={selectedProduct ? `Change ${selectedProduct.name}` : "Select product"}
        type="button"
      >
        <span className="product-sale-selection-copy">
          <strong>{selectedProduct?.name ?? "Select product"}</strong>
          {selectedProduct ? <small>RM{selectedProduct.price.toFixed(2)}</small> : null}
        </span>
      </button>

      {isOpen ? (
        <div className="product-picker-backdrop" onClick={(event) => event.target === event.currentTarget && cancelPicker()} role="presentation">
          <section aria-labelledby="product-picker-title" className="product-picker" role="dialog">
            <header className="product-picker-header">
              <button aria-label="Close product picker" className="product-picker-close" onClick={cancelPicker} type="button">x</button>
              <div>
                <span>PRODUCT CATALOG</span>
                <h2 id="product-picker-title">Select product</h2>
              </div>
              <span aria-hidden="true" className="product-picker-mark">P</span>
            </header>

            <label className="product-picker-search">
              <span aria-hidden="true" className="product-picker-search-icon" />
              <input
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search product or SKU"
                value={query}
              />
              {query ? <button aria-label="Clear product search" onClick={() => setQuery("")} type="button">x</button> : <span aria-hidden="true" />}
            </label>

            <div aria-label="Product categories" className="product-picker-categories" role="tablist">
              {categories.map((option) => (
                <button
                  aria-selected={category === option}
                  className={category === option ? "is-active" : ""}
                  key={option}
                  onClick={() => setCategory(option)}
                  role="tab"
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="product-picker-list">
              {filteredProducts.length ? filteredProducts.map((product) => {
                const stock = product.stock.find((item) => item.branchId === branchId)?.quantity ?? 0;

                return (
                  <button
                    className={product.id === selectedProductId ? "is-selected" : ""}
                    disabled={product.trackInventory && stock <= 0}
                    key={product.id}
                    onClick={() => chooseProduct(product.id)}
                    type="button"
                  >
                    <span aria-hidden="true" className="product-picker-product-icon">P</span>
                    <span className="product-picker-product-copy">
                      <strong>{product.name}</strong>
                      <small>{product.sku || "No SKU"} - {product.trackInventory ? `${stock} in stock` : "inventory not tracked"}</small>
                    </span>
                    <b>RM{product.price.toFixed(2)}</b>
                  </button>
                );
              }) : <p className="product-picker-empty">No matching products.</p>}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

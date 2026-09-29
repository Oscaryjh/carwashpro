"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product, ProductCategory } from "@prisma/client";
import type { BranchOption } from "@/lib/branches";

type ProductFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  categories: Pick<ProductCategory, "id" | "name" | "status">[];
  product?: Omit<Product, "price" | "costPrice" | "taxRate"> & {
    price: number;
    costPrice: number | null;
    taxRate: number | null;
    stocks: Array<{ branchId: string; quantity: number; reorderLevel: number }>;
  };
  submitLabel: string;
  returnPath?: string;
  inventoryEnabled: boolean;
  modalLayout?: boolean;
  companySstRate?: number | null;
};

export function ProductForm({ action, branches, categories, product, submitLabel, returnPath, inventoryEnabled, modalLayout = false, companySstRate }: ProductFormProps) {
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? false);
  const [taxable, setTaxable] = useState(product?.taxable ?? false);
  const [hiddenRateError, setHiddenRateError] = useState(false);
  const hasCompanyRate = typeof companySstRate === "number" && Number.isFinite(companySstRate) && companySstRate >= 0 && companySstRate <= 100;
  return (
    <form action={action} className={modalLayout ? "form product-create-form" : "form"}>
      {product ? <input name="productId" type="hidden" value={product.id} /> : null}
      {returnPath ? <input name="returnPath" type="hidden" value={returnPath} /> : null}
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={product?.name ?? ""} placeholder="Shampoo" required />
        </label>
        <label>
          <span>SKU</span>
          <input
            aria-label="System-generated SKU"
            disabled
            value={product?.sku ?? (modalLayout ? "Assigned automatically" : "Assigned automatically when saved")}
          />
          <small className="field-helper">
            {modalLayout ? "Tetamu will generate a unique SKU when you save this product." : "Tetamu assigns the next unique product number. No manual entry is needed."}
          </small>
        </label>
        <label>
          <span>Category</span>
          <select defaultValue={product?.categoryId ?? ""} name="categoryId" required>
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}{category.status === "INACTIVE" ? " (inactive)" : ""}
              </option>
            ))}
          </select>
          {!categories.length ? <small className="field-helper">{modalLayout ? "No category yet?" : "Create a product category before adding products."} <Link href="/products?modal=categories">Manage categories</Link></small> : null}
        </label>
        <label>
          <span>Price</span>
          <input
            min="0"
            name="price"
            step="0.01"
            type="number"
            defaultValue={product ? Number(product.price).toFixed(2) : ""}
            required
          />
        </label>
        <label>
          <span>{modalLayout ? "Cost price" : "Cost price optional"}</span>
          <input
            min="0"
            name="costPrice"
            step="0.01"
            type="number"
            defaultValue={product?.costPrice == null ? "" : Number(product.costPrice).toFixed(2)}
          />
        </label>
        {modalLayout ? <div className="product-tax-fields">
          <label className="service-taxable-field product-toggle-field">
            <input name="taxable" type="checkbox" checked={taxable} onChange={(event) => {
              setTaxable(event.currentTarget.checked);
              setHiddenRateError(false);
            }} />
            <span className="service-taxable-indicator" aria-hidden="true">✓</span>
            <span className="product-toggle-state" aria-hidden="true">{taxable ? "On" : "Off"}</span>
            <span className="service-taxable-copy"><strong>Taxable product</strong><small>Include SST when this product is sold.</small></span>
          </label>
          {hiddenRateError && !taxable ? <small role="alert" className="form-error">The tax rate is invalid. Turn on Taxable product to correct or clear it before saving.</small> : null}
          <div className="product-tax-rate-slot">
            {/* Keep the enabled input mounted: hiding must not clear or change submitted values. */}
            <div hidden={!taxable}>
              <label>
                <span>Tax rate</span>
                <div className="input-with-suffix">
                  <input name="taxRate" type="number" min="0" max="100" step="0.01"
                    defaultValue={product?.taxRate == null ? "" : Number(product.taxRate).toFixed(2)}
                    placeholder={hasCompanyRate ? `Use company rate: ${companySstRate}%` : "Use company SST rate"}
                    onInvalid={(event) => { if (!taxable) { event.preventDefault(); setHiddenRateError(true); } }} />
                  <span>%</span>
                </div>
                <small className="field-helper">{hasCompanyRate ? "Optional. Enter a different rate only for this product." : "Leave blank to use the company SST rate."}</small>
              </label>
            </div>
          </div>
        </div> : <>
        <label className="service-taxable-field">
          <input defaultChecked={product?.taxable ?? false} name="taxable" type="checkbox" />
          <span className="service-taxable-indicator" aria-hidden="true">✓</span>
          <span className="service-taxable-copy">
            <strong>Taxable product</strong>
            <small>Include SST when this product is sold.</small>
          </span>
        </label>
        <label>
          <span>Tax rate override optional</span>
          <div className="input-with-suffix">
            <input
              max="100"
              min="0"
              name="taxRate"
              placeholder="Use company SST rate"
              step="0.01"
              type="number"
              defaultValue={product?.taxRate == null ? "" : Number(product.taxRate).toFixed(2)}
            />
            <span>%</span>
          </div>
        </label>
        </>}
        {product ? (
          <label>
            <span>Status</span>
            <select defaultValue={product.status} name="status">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>

      <label>
        <span>{modalLayout ? "Description" : "Description optional"}</span>
        <textarea defaultValue={product?.description ?? ""} name="description" rows={3} />
      </label>

      <div className={modalLayout ? "product-inventory-section" : undefined} style={!modalLayout || !inventoryEnabled ? { display: "contents" } : undefined}>
      {modalLayout && inventoryEnabled ? <h3>Inventory</h3> : null}
      {inventoryEnabled ? (
        <label className={modalLayout ? "service-taxable-field product-toggle-field" : "service-taxable-field"}>
          <input
            checked={trackInventory}
            disabled={Boolean(product?.trackInventory)}
            name="trackInventory"
            onChange={(event) => setTrackInventory(event.target.checked)}
            type="checkbox"
          />
          {product?.trackInventory ? <input name="trackInventory" type="hidden" value="on" /> : null}
          <span className="service-taxable-indicator" aria-hidden="true">✓</span>
          {modalLayout ? <span className="product-toggle-state" aria-hidden="true">{trackInventory ? "On" : "Off"}</span> : null}
          <span className="service-taxable-copy">
            <strong>Track inventory</strong>
            <small>{modalLayout ? "Keep track of stock quantity for this product." : "Use the immutable branch stock ledger for this product."}</small>
          </span>
        </label>
      ) : null}

      {inventoryEnabled && trackInventory ? <fieldset className="product-stock-fieldset">
        <legend>{product?.trackInventory ? "Branch inventory" : "Opening balances"}</legend>
        <p className="field-helper">
          {product?.trackInventory
            ? "Balances are read-only here. Use Inventory movements to change quantity."
            : modalLayout ? "Enter the starting stock quantity for each location." : "These explicit quantities create immutable OPENING_BALANCE movements."}
        </p>
        {branches.length ? (
          <div className="field-grid">
            {branches.map((branch) => {
              const stock = product?.stocks.find((item) => item.branchId === branch.id);
              return (
                <label key={branch.id}>
                  <span>{branch.name} quantity</span>
                  <input name={`stock_${branch.id}`} min="0" readOnly={Boolean(product?.trackInventory)} step="1" type="number" defaultValue={stock?.quantity ?? 0} />
                  <span>{branch.name} reorder level</span>
                  <input name={`reorder_${branch.id}`} min="0" step="1" type="number" defaultValue={stock?.reorderLevel ?? 0} />
                </label>
              );
            })}
          </div>
        ) : (
          <p className="empty-state compact-empty-state">Create an active branch before adding stock.</p>
        )}
      </fieldset> : null}
      </div>

      <div className="form-actions">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

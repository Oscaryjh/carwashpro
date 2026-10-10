"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product, ProductCategory } from "@prisma/client";
import type { BranchOption } from "@/lib/branches";
import type { OutletPresentation } from "@/lib/outlet-ui-context";

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
  canViewInventory?: boolean;
  modalLayout?: boolean;
  companySstRate?: number | null;
  outlet?: OutletPresentation;
};

export function ProductForm({ action, branches, categories, product, submitLabel, returnPath, inventoryEnabled, canViewInventory = false, modalLayout = false, companySstRate, outlet = { kind: "legacy_multi_branch" } }: ProductFormProps) {
  const isCreate = !product;
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? false);
  const [taxable, setTaxable] = useState(product?.taxable ?? false);
  const [hiddenRateError, setHiddenRateError] = useState(false);
  const single = outlet.kind === "single_outlet";
  const stockBranches = outlet.kind === "single_outlet" ? branches.filter(branch => branch.id === outlet.internalBranchId)
    : outlet.kind === "legacy_multi_branch" ? branches : [];
  if (outlet.kind === "denied") return <p role="alert">You do not have access to these products.</p>;
  const hasCompanyRate = typeof companySstRate === "number" && Number.isFinite(companySstRate) && companySstRate >= 0 && companySstRate <= 100;
  const priceField = <label>
    <span>Price</span>
    <input min="0" name="price" step="0.01" type="number" defaultValue={product ? Number(product.price).toFixed(2) : ""} required />
  </label>;
  const costField = <label>
    <span>Purchase cost (optional)</span>
    <input min="0" name="costPrice" step="0.01" type="number"
      defaultValue={product?.costPrice == null ? "" : Number(product.costPrice).toFixed(2)}
      onInvalid={isCreate ? (event) => {
        const details = event.currentTarget.closest("details");
        if (details) details.open = true;
      } : undefined} />
    {isCreate ? <small className="field-helper">Used as the default unit cost when creating purchase orders.</small> : null}
  </label>;
  return (
    <form action={action} className={modalLayout ? "form product-create-form" : "form"}>
      {product ? <input name="productId" type="hidden" value={product.id} /> : null}
      {returnPath ? <input name="returnPath" type="hidden" value={returnPath} /> : null}
      <div className="field-grid">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={product?.name ?? ""} placeholder="Shampoo" required />
        </label>
        {isCreate ? priceField : <label>
          <span>SKU</span>
          <input
            aria-label="System-generated SKU"
            disabled
            value={product?.sku ?? (modalLayout ? "Assigned automatically" : "Assigned automatically when saved")}
          />
          <small className="field-helper">
            {modalLayout ? "Tetamu will generate a unique SKU when you save this product." : "Tetamu assigns the next unique product number. No manual entry is needed."}
          </small>
        </label>}
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
        {!isCreate ? <>{priceField}{costField}</> : null}
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

      {!isCreate ? <label>
        <span>{modalLayout ? "Description" : "Description optional"}</span>
        <textarea defaultValue={product?.description ?? ""} name="description" rows={3} />
      </label> : null}

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
            <strong>Track stock</strong>
            <small>{single ? "Turn this on if you want Tetamu POS to keep track of how many units you have." : "Turn this on if you want Tetamu POS to keep track of how many units you have in each store."}</small>
          </span>
        </label>
      ) : null}

      {inventoryEnabled && trackInventory ? <fieldset className="product-stock-fieldset">
        <legend>{product?.trackInventory ? "Stock quantities" : "How many do you have in stock right now?"}</legend>
        <p className="field-helper">
          {product?.trackInventory
            ? "Stock quantities are managed in Inventory."
            : "Enter 0 if you have none. You can add stock later from Inventory."}
        </p>
        {product?.trackInventory && canViewInventory ? <Link href="/inventory">Open Inventory</Link> : null}
        {stockBranches.length ? (
          <div className="field-grid">
            {stockBranches.map((branch) => {
              const stock = product?.stocks.find((item) => item.branchId === branch.id);
              return (
                <div key={branch.id}>
                  {!single ? <p className="field-helper">Store: {branch.name}</p> : null}
                  <label>
                    <span>{product?.trackInventory ? "Current quantity" : "Starting quantity"}</span>
                    <input aria-label={single ? (product?.trackInventory ? "Current quantity" : "Starting quantity") : `${branch.name} ${product?.trackInventory ? "current" : "starting"} quantity`} name={`stock_${branch.id}`} min="0" readOnly={Boolean(product?.trackInventory)} step="1" type="number" defaultValue={stock?.quantity ?? 0} />
                  </label>
                  <details className="product-advanced-settings">
                    <summary>Low stock alert</summary>
                    <label>
                      <span>Low stock alert at</span>
                      <input aria-label={single ? "Low stock alert at" : `${branch.name} low stock alert at`} name={`reorder_${branch.id}`} min="0" step="1" type="number" defaultValue={stock?.reorderLevel ?? 0} />
                      <small className="field-helper">Show a low stock warning when quantity reaches this level.</small>
                    </label>
                  </details>
                </div>
              );
            })}
          </div>
        ) : (
          <p role="status" className="empty-state compact-empty-state">{outlet.kind === "no_location" ? <>This business does not have an operating location set up yet. {outlet.owner ? "Contact the Platform Admin or complete the existing business setup." : "Ask the business owner to complete the setup."}</> : "Stock tracking is on, but there is no active store available for stock quantities yet. Ask the business owner to set up an active store."}</p>
        )}
      </fieldset> : null}
      </div>

      {isCreate ? <details className="product-advanced-settings">
        <summary>Advanced settings</summary>
        <div className="product-advanced-fields">{costField}</div>
      </details> : null}

      <div className="form-actions">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

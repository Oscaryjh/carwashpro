"use client";
import { CheckoutAttribution } from "@/components/performance/checkout-attribution";
import { SafePaymentForm } from "@/components/performance/safe-payment-form";

import { useMemo, useState } from "react";
import { PackageCustomerPicker } from "@/components/package-customer-picker";
import { ProductPicker } from "@/components/product-picker";
import { SaleTaxSummary } from "@/components/sale-tax-summary";
import type { BranchOption } from "@/lib/branches";
import { calculateTax, type TaxDisplaySettings } from "@/lib/tax/calculator";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";
import { FinancialSubmitButton } from "@/components/financial-submit-button";

export type ProductSaleOption = {
  categoryId?: string | null;
  id: string;
  name: string;
  category?: string | null;
  sku: string | null;
  price: number;
  taxable: boolean;
  taxRate: number | null;
  trackInventory: boolean;
  stock: Array<{ branchId: string; quantity: number }>;
};

type ProductSaleLine = {
  productId: string;
  quantity: number;
};

type ProductSaleFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  branchId?: string;
  hideBranch?: boolean;
  includeVehicleDetails?: boolean;
  products: ProductSaleOption[];
  returnTo?: string;
  taxSettings: TaxDisplaySettings;
};

export function ProductSaleForm({
  action,
  branches,
  branchId: initialBranchId,
  hideBranch = false,
  includeVehicleDetails = true,
  products,
  returnTo = "/work-orders",
  taxSettings,
}: ProductSaleFormProps) {
  const [lines, setLines] = useState<ProductSaleLine[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId ?? branches[0]?.id ?? "");
  const [method, setMethod] = useState("CASH");
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const { operationId } = useFinancialOperationId("product-sale");
  const totalItems = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const tax = useMemo(() => calculateTax({
    sstEnabled: taxSettings.enabled,
    sstLabel: taxSettings.label,
    sstRate: taxSettings.rate,
    lines: lines.map((line) => {
      const product = products.find((option) => option.id === line.productId);
      return {
        lineTotal: (product?.price ?? 0) * line.quantity,
        taxable: product?.taxable ?? false,
        taxRate: product?.taxRate ?? null,
      };
    }),
  }), [lines, products, taxSettings]);

  function addLine() {
    if (lines.some((line) => !line.productId)) return;

    const newIndex = lines.length;
    setLines((current) => [...current, { productId: "", quantity: 1 }]);
    setOpenPickerIndex(newIndex);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  function selectProduct(index: number, productId: string) {
    setLines((current) => {
      const currentLine = current[index];
      if (!currentLine) return current;

      const existingIndex = current.findIndex((line, lineIndex) => lineIndex !== index && line.productId === productId);
      if (existingIndex < 0) {
        return current.map((line, lineIndex) => lineIndex === index ? { ...line, productId } : line);
      }

      const selectedProduct = products.find((product) => product.id === productId);
      const availableStock = selectedProduct?.trackInventory
        ? selectedProduct.stock.find((stock) => stock.branchId === branchId)?.quantity ?? 0
        : 99;
      const mergedQuantity = Math.min(
        Math.max(availableStock, 1),
        current[existingIndex].quantity + currentLine.quantity,
      );

      return current
        .map((line, lineIndex) => lineIndex === existingIndex ? { ...line, quantity: mergedQuantity } : line)
        .filter((_, lineIndex) => lineIndex !== index);
    });
    setOpenPickerIndex(null);
  }

  function updateQuantity(index: number, requestedQuantity: number) {
    setLines((current) => {
      const line = current[index];
      const product = products.find((option) => option.id === line?.productId);
      const availableStock = product?.trackInventory
        ? product.stock.find((stock) => stock.branchId === branchId)?.quantity ?? 0
        : 99;
      const maximum = Math.max(availableStock, 1);
      const quantity = Math.min(maximum, Math.max(1, Number.isFinite(requestedQuantity) ? requestedQuantity : 1));

      return current.map((item, lineIndex) => lineIndex === index ? { ...item, quantity } : item);
    });
  }

  return (
    <SafePaymentForm action={action} className="product-sale-form">
      <input name="operationId" type="hidden" value={operationId} />
      <div className="product-sale-section">
        <h3>Customer optional</h3>
        <p className="field-helper">Link the sale to a customer to send the receipt and earn loyalty points.</p>
        <PackageCustomerPicker includeVehicleDetails={includeVehicleDetails} />
      </div>
      <div className="product-sale-section product-sale-cart">
        <div className="product-sale-section-heading">
          <span className="product-sale-label">Products</span>
          <button
            className="product-sale-add"
            disabled={lines.some((line) => !line.productId) || lines.length >= products.length}
            onClick={addLine}
            type="button"
          >
            + Add product
          </button>
        </div>
        <div className="product-sale-lines">
          {lines.map((line, index) => {
            const selectedProduct = products.find((product) => product.id === line.productId);
            const availableStock = selectedProduct?.trackInventory
              ? selectedProduct.stock.find((stock) => stock.branchId === branchId)?.quantity ?? 0
              : 99;
            const lineTotal = (selectedProduct?.price ?? 0) * line.quantity;

            return (
              <div className="product-sale-line" key={`${line.productId}-${index}`}>
                <ProductPicker
                  branchId={branchId}
                  initiallyOpen={openPickerIndex === index}
                  onCancel={() => {
                    if (!line.productId) removeLine(index);
                    setOpenPickerIndex(null);
                  }}
                  onSelect={(productId) => selectProduct(index, productId)}
                  products={products}
                  selectedProductId={line.productId}
                />
                <label className="product-sale-quantity">
                  <span>Qty</span>
                  <input
                    aria-label={`${selectedProduct?.name ?? "Product"} quantity`}
                    inputMode="numeric"
                    max={Math.max(availableStock, 1)}
                    min="1"
                    name="quantity"
                    onChange={(event) => updateQuantity(index, Number(event.target.value))}
                    type="number"
                    value={line.quantity}
                    required
                  />
                </label>
                <strong className="product-sale-line-total">RM{lineTotal.toFixed(2)}</strong>
                <button
                  aria-label={`Remove ${selectedProduct?.name ?? "product"}`}
                  className="product-sale-remove"
                  onClick={() => removeLine(index)}
                  title="Remove product"
                  type="button"
                >
                  <span aria-hidden="true">x</span>
                </button>
                <input name="productId" type="hidden" value={line.productId} />
              </div>
            );
          })}
        </div>
        {hideBranch ? (
          <input name="branchId" type="hidden" value={branchId} />
        ) : (
          <label>
            <span>Branch</span>
            <select name="branchId" onChange={(event) => setBranchId(event.target.value)} value={branchId} required>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <SaleTaxSummary
        itemLabel={`${totalItems} ${totalItems === 1 ? "item" : "items"}`}
        sstEnabled={taxSettings.enabled}
        tax={tax}
      />
      <div className="product-sale-section">
        <label>
          <span>Payment method</span>
          <select name="method" onChange={(event) => setMethod(event.target.value)} value={method}>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="EWALLET">E-wallet</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </label>
        {method !== "CASH" ? <label><span>Reference</span><input name="reference" placeholder="Receipt or transaction reference" required /></label> : null}
      </div>
      <input name="returnTo" type="hidden" value={returnTo} />
      <CheckoutAttribution branchId={branchId} exempt={tax.total <= 0} />
      <div className="form-actions">
        <FinancialSubmitButton
          disabled={!lines.length || !branches.length || lines.some((line) => {
            const product = products.find((option) => option.id === line.productId);
            return !line.productId || Boolean(product?.trackInventory && line.quantity > (product.stock.find((stock) => stock.branchId === branchId)?.quantity ?? 0));
          })}
          pendingLabel="Processing sale..."
        >
          Pay RM{tax.total.toFixed(2)}
        </FinancialSubmitButton>
      </div>
    </SafePaymentForm>
  );
}

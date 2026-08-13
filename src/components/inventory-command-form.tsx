"use client";

import { useState } from "react";
import type { BranchOption } from "@/lib/branches";

type InventoryCommandFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  mode: "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT" | "TRANSFER";
  products: Array<{ id: string; name: string; sku: string | null; stocks: Array<{ branchId: string; quantity: number; revision: number }> }>;
};

export function InventoryCommandForm({ action, branches, mode, products }: InventoryCommandFormProps) {
  const [operationKey] = useState(() => `inventory:${mode.toLowerCase()}:${crypto.randomUUID()}`);
  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState("");
  const transfer = mode === "TRANSFER";
  const selectedStock = products
    .find((product) => product.id === productId)
    ?.stocks.find((stock) => stock.branchId === branchId);
  const expectedRevision = selectedStock?.revision ?? 0;
  return (
    <form action={action} className="form">
      <input name="operationKey" type="hidden" value={operationKey} />
      <div className="field-grid">
        <label>
          <span>Product</span>
          <select name="productId" onChange={(event) => setProductId(event.target.value)} value={productId} required>
            <option value="">Select tracked product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{transfer ? "Source branch" : "Branch"}</span>
          <select name={transfer ? "sourceBranchId" : "branchId"} onChange={(event) => setBranchId(event.target.value)} value={branchId} required>
            <option value="">Select branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        {transfer ? (
          <label>
            <span>Destination branch</span>
            <select name="destinationBranchId" required>
              <option value="">Select branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          <span>{mode === "ADJUSTMENT" ? "Delta (+ / -)" : "Quantity"}</span>
          <input name={mode === "ADJUSTMENT" ? "delta" : "quantity"} step="1" type="number" {...(mode === "ADJUSTMENT" ? {} : { min: 1 })} required />
        </label>
        {mode === "ADJUSTMENT" ? <input name="expectedRevision" type="hidden" value={expectedRevision} /> : null}
        <label>
          <span>Reference optional</span>
          <input name="reference" maxLength={120} />
        </label>
      </div>
      {productId && branchId ? (
        <p className="form-message">
          Current stock: <strong>{selectedStock?.quantity ?? 0}</strong>
          {mode === "TRANSFER" ? " at the source branch" : ""}
        </p>
      ) : null}
      <label>
        <span>Reason</span>
        <textarea name="reason" minLength={3} rows={2} required />
      </label>
      <p className="field-helper">Adjustments use the latest balance revision. If stock changes concurrently, the command is rejected safely.</p>
      <div className="form-actions"><button disabled={!products.length || !branches.length} type="submit">{labelForMode(mode)}</button></div>
    </form>
  );
}

function labelForMode(mode: InventoryCommandFormProps["mode"]) {
  if (mode === "STOCK_IN") return "Record stock in";
  if (mode === "STOCK_OUT") return "Record stock out";
  if (mode === "ADJUSTMENT") return "Record delta adjustment";
  return "Complete transfer";
}

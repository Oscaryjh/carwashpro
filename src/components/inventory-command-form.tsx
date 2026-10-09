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
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [actualQuantity, setActualQuantity] = useState("");
  const transfer = mode === "TRANSFER";
  const selectedStock = products
    .find((product) => product.id === productId)
    ?.stocks.find((stock) => stock.branchId === branchId);
  const expectedRevision = selectedStock?.revision ?? 0;
  const adjustment = mode === "ADJUSTMENT";
  const delta = actualQuantity === "" ? "" : Number(actualQuantity) - (selectedStock?.quantity ?? 0);
  const validActual = actualQuantity !== "" && Number.isSafeInteger(Number(actualQuantity)) && Number(actualQuantity) >= 0 && delta !== 0 && Boolean(productId && branchId);
  if (!branches.length) return <p role="alert">No active store location is available. Contact your administrator.</p>;
  if (transfer && branches.length < 2) return <p>Transfers require at least two authorised locations within this business. Stock cannot be transferred to another business here.</p>;
  return (
    <form action={action} className="form">
      <input name="operationKey" type="hidden" value={operationKey} />
      <div className="field-grid">
        <label>
          <span>Product</span>
          <select name="productId" onChange={(event) => { setProductId(event.target.value); setActualQuantity(""); }} value={productId} required>
            <option value="">Select tracked product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>
            ))}
          </select>
        </label>
        {branches.length === 1 && !transfer ? <input type="hidden" name="branchId" value={branchId} /> : <label>
          <span>{transfer ? "Source branch" : "Branch"}</span>
          <select name={transfer ? "sourceBranchId" : "branchId"} onChange={(event) => { setBranchId(event.target.value); setActualQuantity(""); }} value={branchId} required>
            <option value="">Select branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>}
        {transfer ? (
          <label>
            <span>Destination branch</span>
            <select name="destinationBranchId" required>
              <option value="">Select branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        ) : null}
        {adjustment ? <label>
          <span>Actual quantity</span>
          <input aria-label="Actual quantity" value={actualQuantity} onChange={event => setActualQuantity(event.target.value)} min="0" step="1" type="number" disabled={!productId || !branchId} required />
          <input name="delta" type="hidden" value={delta} />
        </label> : <label><span>Quantity</span><input name="quantity" step="1" type="number" min="1" required /></label>}
        {mode === "ADJUSTMENT" ? <input name="expectedRevision" type="hidden" value={expectedRevision} /> : null}
        <label>
          <span>Reference optional</span>
          <input name="reference" maxLength={120} />
        </label>
      </div>
      {productId && branchId ? (
        <p className="form-message">
          Current quantity: <strong>{selectedStock?.quantity ?? 0}</strong>
          {mode === "TRANSFER" ? " at the source branch" : ""}
          {adjustment && actualQuantity !== "" ? <> · Change: <strong>{Number(delta) > 0 ? "+" : ""}{delta}</strong></> : null}
        </p>
      ) : null}
      <label>
        <span>Reason</span>
        <textarea name="reason" minLength={3} rows={2} required />
      </label>
      {adjustment ? <p className="field-helper">If stock has changed since this page opened, refresh and check the quantity before trying again.</p> : null}
      <div className="form-actions"><button disabled={!products.length || !branches.length || (adjustment && !validActual)} type="submit">{labelForMode(mode)}</button></div>
    </form>
  );
}

function labelForMode(mode: InventoryCommandFormProps["mode"]) {
  if (mode === "STOCK_IN") return "Add stock";
  if (mode === "STOCK_OUT") return "Record stock removed";
  if (mode === "ADJUSTMENT") return "Correct stock quantity";
  return "Move stock";
}

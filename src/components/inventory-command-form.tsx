"use client";

import { useState } from "react";
import type { BranchOption } from "@/lib/branches";

type InventoryCommandFormProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  mode: "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT" | "TRANSFER";
  products: Array<{ id: string; name: string; sku: string | null; stocks: Array<{ branchId: string; quantity: number; revision: number }> }>;
  initialProductId?: string;
  initialBranchId?: string;
};

export function InventoryCommandForm({ action, branches, mode, products, initialProductId, initialBranchId }: InventoryCommandFormProps) {
  const [operationKey] = useState(() => `inventory:${mode.toLowerCase()}:${crypto.randomUUID()}`);
  const [productId, setProductId] = useState(products.some(p => p.id === initialProductId) ? initialProductId! : "");
  const [branchId, setBranchId] = useState(branches.some(b => b.id === initialBranchId) ? initialBranchId! : branches.length === 1 ? branches[0].id : "");
  const [actualQuantity, setActualQuantity] = useState("");
  const [note, setNote] = useState("");
  const [removalReason, setRemovalReason] = useState("Used");
  const transfer = mode === "TRANSFER";
  const selectedStock = products
    .find((product) => product.id === productId)
    ?.stocks.find((stock) => stock.branchId === branchId);
  const expectedRevision = selectedStock?.revision ?? 0;
  const adjustment = mode === "ADJUSTMENT";
  const removal = mode === "STOCK_OUT";
  const needsNote = adjustment || (removal && removalReason === "Other");
  const reasonPrefix = removal ? removalReason : transfer ? "Stock transferred" : "Stock added";
  const reason = adjustment ? note.trim() : `${reasonPrefix}${note.trim() ? `: ${note.trim()}` : ""}`;
  const delta = actualQuantity === "" ? "" : Number(actualQuantity) - (selectedStock?.quantity ?? 0);
  const validActual = actualQuantity !== "" && Number.isSafeInteger(Number(actualQuantity)) && Number(actualQuantity) >= 0 && delta !== 0 && Boolean(productId && branchId);
  if (!branches.length) return <p role="alert">No active store location is available. Contact your administrator.</p>;
  if (transfer && branches.length < 2) return <p>Transfers require at least two authorised locations within this business. Stock cannot be transferred to another business here.</p>;
  const productField = (
        <label>
          <span>Product</span>
          <select name="productId" onChange={(event) => { setProductId(event.target.value); setActualQuantity(""); }} value={productId} required>
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>
            ))}
          </select>
        </label>
  );
  return (
    <form action={action} className="form">
      <input name="operationKey" type="hidden" value={operationKey} />
      <div className="field-grid">
        {!transfer ? productField : null}
        {branches.length === 1 && !transfer ? <div><span>Store</span><p>{branches[0].name}</p><input type="hidden" name="branchId" value={branchId} /></div> : <label>
          <span>{transfer ? "From Store" : "Store"}</span>
          <select name={transfer ? "sourceBranchId" : "branchId"} onChange={(event) => { setBranchId(event.target.value); setActualQuantity(""); }} value={branchId} required>
            <option value="">Select store</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>}
        {transfer ? (
          <label>
            <span>To Store</span>
            <select name="destinationBranchId" required>
              <option value="">Select store</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        ) : null}
        {transfer ? productField : null}
        {adjustment ? <label>
          <span>Actual quantity</span>
          <input aria-label="Actual quantity" value={actualQuantity} onChange={event => setActualQuantity(event.target.value)} min="0" step="1" type="number" disabled={!productId || !branchId} required />
          <input name="delta" type="hidden" value={delta} />
        </label> : <label><span>Quantity</span><input name="quantity" step="1" type="number" min="1" required /></label>}
        {mode === "ADJUSTMENT" ? <input name="expectedRevision" type="hidden" value={expectedRevision} /> : null}
        <details><summary>Optional reference</summary><label>
          <span>Reference optional</span>
          <input name="reference" maxLength={120} />
        </label></details>
      </div>
      {productId && branchId ? (
        <p className="form-message">
          Current stock: <strong>{selectedStock?.quantity ?? 0}</strong>
          {mode === "TRANSFER" ? " at the source branch" : ""}
          {adjustment && actualQuantity !== "" ? <> · Change: <strong>{Number(delta) > 0 ? "+" : ""}{delta}</strong></> : null}
        </p>
      ) : null}
      {adjustment && actualQuantity !== "" && delta === 0 ? <p role="status">Stock matches. No update needed.</p> : null}
      {removal ? <label><span>Reason</span><select aria-label="Reason" value={removalReason} onChange={e => setRemovalReason(e.target.value)}>{["Used", "Damaged", "Lost", "Other"].map(value => <option key={value}>{value}</option>)}</select></label> : null}
      <input name="reason" type="hidden" value={reason} />
      <label><span>{adjustment ? "Reason for correction" : needsNote ? "Please explain" : "Note (optional)"}</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} minLength={needsNote ? 3 : undefined} maxLength={adjustment ? 500 : 470} rows={2} required={needsNote} />
      </label>
      {adjustment ? <p className="field-helper">If stock has changed since this page opened, refresh and check the quantity before trying again.</p> : null}
      <div className="form-actions"><button disabled={!products.length || !branches.length || (adjustment && !validActual) || (needsNote && note.trim().length < 3)} type="submit">{labelForMode(mode)}</button></div>
    </form>
  );
}

function labelForMode(mode: InventoryCommandFormProps["mode"]) {
  if (mode === "STOCK_IN") return "Add Stock";
  if (mode === "STOCK_OUT") return "Confirm";
  if (mode === "ADJUSTMENT") return "Update stock";
  return "Transfer";
}

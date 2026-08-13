"use client";

import { useState } from "react";

type ProductOption = { costPrice: number | null; id: string; name: string; sku: string | null };

export function PurchaseOrderForm({ action, branches, expectedRevision, initial, operationKey, prefill, products, purchaseOrderId, submitLabel = "Create draft PO", suppliers }: { action: (formData: FormData) => void | Promise<void>; branches: Array<{ id: string; name: string }>; expectedRevision?: number; initial?: { branchId: string; expectedDate?: string; lines: Array<{ expectedUnitCost: number; orderedQuantity: number; productId: string }>; notes?: string; orderDate: string; supplierId: string }; operationKey: string; prefill?: { branchId: string; productId: string; quantity: number }; products: ProductOption[]; purchaseOrderId?: string; submitLabel?: string; suppliers: Array<{ id: string; name: string }> }) {
  const prefilledProduct = products.find((product) => product.id === prefill?.productId);
  const [lines, setLines] = useState(initial?.lines ?? (prefill && prefilledProduct ? [{ expectedUnitCost: prefilledProduct.costPrice ?? 0, orderedQuantity: prefill.quantity, productId: prefill.productId }] : [{ expectedUnitCost: products[0]?.costPrice ?? 0, orderedQuantity: 1, productId: products[0]?.id ?? "" }]));
  const encoded = JSON.stringify(lines);
  return <form action={action} className="form-grid">
    <input type="hidden" name="operationKey" value={operationKey} />
    <input type="hidden" name="lines" value={encoded} />
    {purchaseOrderId ? <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} /> : null}{expectedRevision !== undefined ? <input type="hidden" name="expectedRevision" value={expectedRevision} /> : null}
    <label>Supplier<select name="supplierId" required defaultValue={initial?.supplierId ?? ""}><option value="" disabled>Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
    <label>Branch<select name="branchId" required disabled={Boolean(initial)} defaultValue={initial?.branchId ?? prefill?.branchId ?? branches[0]?.id}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    <label>Order date<input name="orderDate" type="date" required defaultValue={initial?.orderDate ?? new Date().toISOString().slice(0, 10)} /></label>
    <label>Expected date<input name="expectedDate" type="date" defaultValue={initial?.expectedDate ?? ""} /></label>
    <div className="full-width"><div className="section-header"><h2>Order lines</h2><button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, { expectedUnitCost: products[0]?.costPrice ?? 0, orderedQuantity: 1, productId: products[0]?.id ?? "" }])}>Add line</button></div>
      {lines.map((line, index) => <div className="filter-bar" key={index}>
        <select aria-label={`Product ${index + 1}`} value={line.productId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expectedUnitCost: product?.costPrice ?? 0, productId: event.target.value } : item)); }}><option value="" disabled>Select tracked product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` (${product.sku})` : ""}</option>)}</select>
        <input aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1" value={line.orderedQuantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, orderedQuantity: Number(event.target.value) } : item))} />
        <input aria-label={`Expected unit cost ${index + 1}`} type="number" min="0" step="0.01" value={line.expectedUnitCost} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expectedUnitCost: Number(event.target.value) } : item))} />
        <button type="button" className="danger-button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
      </div>)}
    </div>
    <label className="full-width">Notes<textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} /></label>
    <div className="form-actions full-width"><button type="submit" disabled={!products.length || !suppliers.length || !branches.length}>{submitLabel}</button></div>
  </form>;
}

export function GoodsReceiveForm({ action, lines, operationKey, purchaseOrderId }: { action: (formData: FormData) => void | Promise<void>; lines: Array<{ id: string; orderedQuantity: number; productName: string; receivedQuantity: number }>; operationKey: string; purchaseOrderId: string }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const payload = lines.map((line) => ({ purchaseOrderLineId: line.id, quantity: quantities[line.id] ?? 0 })).filter((line) => line.quantity > 0);
  return <form action={action} className="form-grid">
    <input type="hidden" name="operationKey" value={operationKey} /><input type="hidden" name="purchaseOrderId" value={purchaseOrderId} /><input type="hidden" name="lines" value={JSON.stringify(payload)} />
    <div className="full-width table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Receive now</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td>{line.productName}</td><td>{line.orderedQuantity}</td><td>{line.receivedQuantity}</td><td>{line.orderedQuantity - line.receivedQuantity}</td><td><input aria-label={`Receive ${line.productName}`} type="number" min="0" max={line.orderedQuantity - line.receivedQuantity} step="1" value={quantities[line.id] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: Number(event.target.value) }))} /></td></tr>)}</tbody></table></div>
    <label>Delivery reference<input name="deliveryReference" maxLength={120} /></label><label className="full-width">Notes<textarea name="notes" rows={2} /></label><div className="form-actions full-width"><button type="submit" disabled={!payload.length}>Post goods receipt</button></div>
  </form>;
}

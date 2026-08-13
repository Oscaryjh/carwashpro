import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { reconcileInventory } from "@/lib/inventory/service";

type ReconciliationPageProps = { searchParams: Promise<{ branchId?: string }> };

export default async function ReconciliationPage({ searchParams }: ReconciliationPageProps) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY");
  const params = await searchParams;
  const branches = await getOperationalBranches(businessId, user);
  const selectedBranchId = branches.some((branch) => branch.id === params.branchId)
    ? params.branchId!
    : branches.length === 1 ? branches[0].id : null;
  const result = await reconcileInventory(businessId, selectedBranchId);
  return (
    <section className="content">
      <div className="page-header"><div><h1>Inventory reconciliation</h1><p>Compare balances, sales, goods receipts, PO quantities, and approved stock-count variances with their canonical movements.</p></div></div>
      {branches.length > 1 ? <form className="filter-bar"><select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><button type="submit">Run check</button></form> : null}
      <div className="panel">
        <div className="section-header"><h2>Result</h2><span className={`status ${result.ok ? "active" : "warning"}`}>{result.ok ? "MATCH" : "MISMATCH"}</span></div>
        {result.ok ? <p className="form-message success">Balances, ledger quantities, and tracked sale lines reconcile.</p> : (
          <>
            <h3>Balance mismatches</h3>
            {result.balanceMismatches.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Branch</th><th>Balance</th><th>Ledger</th></tr></thead><tbody>{result.balanceMismatches.map((item) => <tr key={`${item.branchId}:${item.productId}`}><td>{item.productName}</td><td>{item.branchName}</td><td>{item.balanceQuantity}</td><td>{item.ledgerQuantity}</td></tr>)}</tbody></table></div> : <p>None.</p>}
            <h3>Sale movement mismatches</h3>
            {result.saleMismatches.length ? <div className="table-wrap"><table><thead><tr><th>Invoice item</th><th>Sold qty</th><th>Movement count</th><th>Movement delta</th><th>Mismatch</th></tr></thead><tbody>{result.saleMismatches.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.quantity}</td><td>{item.movementCount}</td><td>{item.movementQuantity}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : <p>None.</p>}
            <h3>Goods receipt movement mismatches</h3>
            {result.receiptMismatches.length ? <div className="table-wrap"><table><thead><tr><th>Receipt line / movement</th><th>Movement count</th><th>Movement delta</th><th>Mismatch</th></tr></thead><tbody>{result.receiptMismatches.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.movementCount}</td><td>{item.movementQuantity}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : <p>None.</p>}
            <h3>Receipt reversal movement mismatches</h3>
            {result.reversalMismatches.length ? <div className="table-wrap"><table><thead><tr><th>Reversal / movement</th><th>Movement count</th><th>Movement delta</th><th>Mismatch</th></tr></thead><tbody>{result.reversalMismatches.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.movementCount}</td><td>{item.movementQuantity}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : <p>None.</p>}
            <h3>Purchase order received-quantity mismatches</h3>
            {result.purchaseOrderMismatches.length ? <div className="table-wrap"><table><thead><tr><th>PO line</th><th>Materialized</th><th>Receipts less reversals</th><th>Mismatch</th></tr></thead><tbody>{result.purchaseOrderMismatches.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.materializedQuantity}</td><td>{item.receiptQuantity}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : <p>None.</p>}
            <h3>Stock-count variance movement mismatches</h3>
            {result.stockCountMismatches.length ? <div className="table-wrap"><table><thead><tr><th>Count line / movement</th><th>Expected delta</th><th>Movement count</th><th>Movement delta</th><th>Mismatch</th></tr></thead><tbody>{result.stockCountMismatches.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.expectedQuantity}</td><td>{item.movementCount}</td><td>{item.movementQuantity}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : <p>None.</p>}
          </>
        )}
      </div>
      <p className="field-helper">This page never repairs data automatically. Local/Testing rebuilds require an explicit engineering command and are not exposed to Production.</p>
    </section>
  );
}

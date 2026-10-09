import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { stockInAction } from "../actions";
export default async function StockInPage({ searchParams }: { searchParams: Promise<{ productId?: string; branchId?: string }> }) { const selection = await searchParams; const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className={`content ${styles.workflow}`}><div className="page-header"><div><h1>Add Stock</h1><p>Add items received into your store.</p></div><Link href="/inventory">Back to inventory</Link></div><div className="panel"><InventoryCommandForm key={`${selection.productId ?? ""}:${selection.branchId ?? ""}`} initialProductId={selection.productId} initialBranchId={selection.branchId} action={stockInAction} branches={branches} mode="STOCK_IN" products={products} /></div></section>; }

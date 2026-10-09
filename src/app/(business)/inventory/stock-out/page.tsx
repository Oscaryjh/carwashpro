import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { stockOutAction } from "../actions";
export default async function StockOutPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className={`content ${styles.workflow}`}><div className="page-header"><div><h1>Use / Remove</h1><p>Sales already reduce stock automatically. Use this only for items removed outside sales.</p></div><Link href="/inventory">Back to inventory</Link></div><div className="panel"><InventoryCommandForm action={stockOutAction} branches={branches} mode="STOCK_OUT" products={products} /></div></section>; }

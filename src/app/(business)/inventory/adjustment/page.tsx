import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { adjustInventoryAction } from "../actions";
export default async function AdjustmentPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "ADJUST_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className={`content ${styles.workflow}`}><div className="page-header"><div><h1>Correct stock quantity</h1><p>Enter the actual quantity that should be in store and explain the correction.</p></div><Link href="/inventory">Back to inventory</Link></div><div className="panel"><InventoryCommandForm action={adjustInventoryAction} branches={branches} mode="ADJUSTMENT" products={products} /></div></section>; }

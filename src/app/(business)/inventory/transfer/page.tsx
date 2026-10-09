import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { transferInventoryAction } from "../actions";
export default async function TransferPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "TRANSFER_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className={`content ${styles.workflow}`}><div className="page-header"><div><h1>Transfer</h1><p>Move stock from one store to another. Both stores are updated together.</p></div><Link href="/inventory">Back to inventory</Link></div><div className="panel"><InventoryCommandForm action={transferInventoryAction} branches={branches} mode="TRANSFER" products={products} /></div></section>; }

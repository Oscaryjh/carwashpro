import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { stockInAction } from "../actions";
export default async function StockInPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className="content"><div className="page-header"><div><h1>Stock in</h1><p>Record received stock as an immutable positive movement.</p></div></div><div className="panel"><InventoryCommandForm action={stockInAction} branches={branches} mode="STOCK_IN" products={products} /></div></section>; }

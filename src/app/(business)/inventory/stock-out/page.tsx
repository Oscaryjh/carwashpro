import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { stockOutAction } from "../actions";
export default async function StockOutPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className="content"><div className="page-header"><div><h1>Stock out</h1><p>Record a reasoned stock removal. Negative stock is blocked.</p></div></div><div className="panel"><InventoryCommandForm action={stockOutAction} branches={branches} mode="STOCK_OUT" products={products} /></div></section>; }

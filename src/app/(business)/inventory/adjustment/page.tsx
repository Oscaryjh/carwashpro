import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { adjustInventoryAction } from "../actions";
export default async function AdjustmentPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "ADJUST_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className="content"><div className="page-header"><div><h1>Stock adjustment</h1><p>Enter a signed delta. Existing balances are never overwritten.</p></div></div><div className="panel"><InventoryCommandForm action={adjustInventoryAction} branches={branches} mode="ADJUSTMENT" products={products} /></div></section>; }

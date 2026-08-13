import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { transferInventoryAction } from "../actions";
export default async function TransferPage() { const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "TRANSFER_INVENTORY"); const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } })]); return <section className="content"><div className="page-header"><div><h1>Branch transfer</h1><p>One completed command creates paired TRANSFER_OUT and TRANSFER_IN movements.</p></div></div><div className="panel"><InventoryCommandForm action={transferInventoryAction} branches={branches} mode="TRANSFER" products={products} /></div></section>; }

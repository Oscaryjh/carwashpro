import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { ProductForm } from "@/components/product-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { deactivateProductAction, updateProductAction } from "../actions";

export default async function ProductDetailsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PRODUCTS");
  const { productId } = await params;
  const [product, branches, categories] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, businessId }, include: { stocks: true } }),
    getActiveBranches(businessId),
    prisma.productCategory.findMany({ where: { businessId }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
  ]);
  if (!product) notFound();

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div><h1>{product.name}</h1><p>Edit product details and branch stock.</p></div><BackButton fallbackHref="/products" /></div>
        <div className="panel"><div className="section-header"><h2>Edit product</h2><span className={`status ${product.status.toLowerCase()}`}>{product.status}</span></div><ProductForm action={updateProductAction} branches={branches} categories={categories} product={product} submitLabel="Save product" /><form action={deactivateProductAction} className="form-actions"><input name="productId" type="hidden" value={product.id} /><button className="danger-button" type="submit">Deactivate product</button></form></div>
      </section>
    </AppShell>
  );
}

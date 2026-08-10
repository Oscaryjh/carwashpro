import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { ProductForm } from "@/components/product-form";
import { DeleteProductForm } from "@/components/delete-product-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { deactivateProductAction, updateProductAction } from "../actions";

export default async function ProductDetailsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const { productId } = await params;
  const [product, branches, categories] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, businessId }, include: { stocks: true } }),
    getActiveBranches(businessId),
    prisma.productCategory.findMany({ where: { businessId }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
  ]);
  if (!product) notFound();
  const productForForm = {
    ...product,
    price: Number(product.price),
    costPrice: product.costPrice == null ? null : Number(product.costPrice),
    taxRate: product.taxRate == null ? null : Number(product.taxRate),
  };

  return (
    <>
      <section className="content">
        <div className="page-header"><div><h1>{product.name}</h1><p>Edit product details and branch stock.</p></div><BackButton fallbackHref="/products" /></div>
        <div className="panel"><div className="section-header"><h2>Edit product</h2><span className={`status ${product.status.toLowerCase()}`}>{product.status}</span></div><ProductForm action={updateProductAction} branches={branches} categories={categories} product={productForForm} submitLabel="Save product" /><div className="form-actions service-action-row"><form action={deactivateProductAction}><input name="productId" type="hidden" value={product.id} /><button className="danger-button" type="submit">Deactivate product</button></form><DeleteProductForm productId={product.id} productName={product.name} label="Delete product" /></div></div>
      </section>
    </>
  );
}

import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { ProductForm } from "@/components/product-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createProductAction } from "../actions";

export default async function NewProductPage() {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PRODUCTS");
  const [branches, categories] = await Promise.all([
    getActiveBranches(businessId),
    prisma.productCategory.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div><h1>New Product</h1><p>Add a retail item for sale at the Cashier.</p></div><BackButton fallbackHref="/products" /></div>
        <div className="panel"><div className="section-header"><h2>Product details</h2></div><ProductForm action={createProductAction} branches={branches} categories={categories} submitLabel="Create product" /></div>
      </section>
    </AppShell>
  );
}

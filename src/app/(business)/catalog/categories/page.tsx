import Link from "next/link";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";

export default async function CatalogCategoriesPage() {
  const { user } = await requireBusinessUser();
  const options = [
    { permission: "SERVICES" as const, href: "/services?modal=categories", title: "Service categories", description: "Organize bookable and checkout services." },
    { permission: "PACKAGES" as const, href: "/packages?modal=categories", title: "Package categories", description: "Group prepaid packages by purpose." },
    { permission: "PRODUCTS" as const, href: "/products?modal=categories", title: "Product categories", description: "Keep large SKU catalogs easy to browse." },
  ].filter((option) => hasStaffPermission(user, option.permission));

  if (!options.length) redirect("/login");

  return (
    <section className="content">
      <div className="page-header"><div><h1>Categories</h1><p>Manage every catalog category from one place.</p></div></div>
      <div className="catalog-category-hub">
        {options.map((option) => (
          <Link href={option.href} key={option.href}>
            <strong>{option.title}</strong>
            <span>{option.description}</span>
            <b>Manage</b>
          </Link>
        ))}
      </div>
    </section>
  );
}

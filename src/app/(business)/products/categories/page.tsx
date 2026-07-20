import { redirect } from "next/navigation";

export default function ProductCategoriesPage() {
  redirect("/products?modal=categories");
}

import { redirect } from "next/navigation";

export default function PackageCategoriesPage() {
  redirect("/packages?modal=categories");
}

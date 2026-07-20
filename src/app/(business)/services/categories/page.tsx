import { redirect } from "next/navigation";

export default function ServiceCategoriesPage() {
  redirect("/services?modal=categories");
}

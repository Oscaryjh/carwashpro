import { redirect } from "next/navigation";

export default async function NewBranchPage() {
  redirect("/branches");
}

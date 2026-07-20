import { redirect } from "next/navigation";

export default function NewPackagePage() {
  redirect("/packages?modal=create");
}

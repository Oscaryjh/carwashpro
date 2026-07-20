import { redirect } from "next/navigation";

export default function NewServicePage() {
  redirect("/services?modal=create");
}

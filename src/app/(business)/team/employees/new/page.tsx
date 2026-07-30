import { redirect } from "next/navigation";

export default async function NewAttendanceEmployeePage() {
  redirect("/team?section=people&modal=create");
}

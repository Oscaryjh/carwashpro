import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getEmployeeSelfServiceAuthContext,
} from "@/lib/attendance/employee-auth/session";
import { canAccessStaffApprovals } from "@/lib/staff-pwa/approval-navigation";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function StaffRequestsPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");

  // Keep old bookmarks safe without another gateway screen.
  redirect(await canAccessStaffApprovals(auth) ? "/staff/approvals" : "/staff");
}

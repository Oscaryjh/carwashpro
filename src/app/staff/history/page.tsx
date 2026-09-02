import type { Metadata } from "next";
import { StaffTimeHub } from "@/components/staff-pwa/staff-time-hub";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import { getStaffTimeHub } from "@/lib/staff-pwa/time-hub";

export const metadata: Metadata = { title: "Time" };
export const dynamic = "force-dynamic";

export default async function StaffHistoryPage() {
  const auth = await requireEmployeeModulePage("HR");
  const model = await getStaffTimeHub(auth);
  return <StaffTimeHub model={model} />;
}

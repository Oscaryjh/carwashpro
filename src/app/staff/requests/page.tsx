import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import {
  StaffV2ActionRow,
  StaffV2ListRow,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  staffV2Styles as styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import {
  getEmployeeSelfServiceAuthContext,
} from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { loadRequestsApprovalEntry } from "@/lib/staff-pwa/requests-hub";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

export default async function StaffRequestsPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");

  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const hasHr = enabledModules.has("HR");
  const hasClaims = enabledModules.has("CLAIMS");
  if (!hasHr && !hasClaims) redirect("/staff/module-not-enabled?module=HR");

  const approvalEntry = await loadRequestsApprovalEntry(auth);

  return (
    <section aria-label="Requests" className={styles.scope}>
      <StaffV2PageHeader
        meta={approvalEntry
          ? "Manage your requests and team approvals."
          : "Manage your leave, claims and attendance corrections."}
        title="Requests"
      />

      {approvalEntry ? (
        <StaffV2ActionRow
          ariaLabel={`Open Approvals, ${approvalEntry.meta}`}
          href="/staff/approvals"
          leading={<StaffAppIcon name="document" />}
          meta={approvalEntry.meta}
          title="Approvals"
        />
      ) : null}

      <section aria-labelledby="staff-my-requests-heading">
        <StaffV2SectionLabel id="staff-my-requests-heading">My requests</StaffV2SectionLabel>
        <StaffV2RowGroup ariaLabel="My requests">
          {hasHr ? (
            <StaffV2ListRow
              ariaLabel="Open Leave balances, requests and history"
              href="/staff/leave"
              leading={<StaffAppIcon name="leaf" />}
              meta="Balances, requests and history"
              title="Leave"
            />
          ) : null}
          {hasClaims ? (
            <StaffV2ListRow
              ariaLabel="Open Claims expenses you've submitted"
              href="/staff/claims"
              leading={<StaffAppIcon name="receipt" />}
              meta="Expenses you've submitted"
              title="Claims"
            />
          ) : null}
          {hasHr ? (
            <StaffV2ListRow
              ariaLabel="Open Attendance corrections for missing or incorrect attendance"
              href="/staff/history/records"
              leading={<StaffAppIcon name="clock" />}
              meta="Missing or incorrect attendance"
              title="Attendance corrections"
            />
          ) : null}
        </StaffV2RowGroup>
      </section>
    </section>
  );
}

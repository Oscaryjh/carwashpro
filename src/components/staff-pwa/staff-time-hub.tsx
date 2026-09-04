import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import type { StaffTimeHubModel } from "@/lib/staff-pwa/time-hub";
import {
  StaffV2ActionRow,
  StaffV2ListRow,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  staffV2Styles as styles,
} from "./staff-v2-primitives";
import { StaffTimeHubLegacyRedirect } from "./staff-time-hub-legacy-redirect";

export function StaffTimeHub({ model }: { model: StaffTimeHubModel }) {
  return (
    <section aria-label="Time" className={styles.scope}>
      <StaffTimeHubLegacyRedirect />
      <StaffV2PageHeader
        meta="Attendance records, corrections and monthly work results."
        title="Time"
      />

      {model.attention ? (
        <section aria-labelledby="staff-time-attention-heading">
          <StaffV2SectionLabel id="staff-time-attention-heading">Needs attention</StaffV2SectionLabel>
          <StaffV2ActionRow
            ariaLabel={model.attention.count === 1
              ? "Fix attendance issue"
              : `Open ${model.attention.count} attendance issues`}
            href={model.attention.href}
            kicker="Attendance"
            leading={<StaffAppIcon name="document" />}
            meta={model.attention.meta}
            title="Attendance needs attention"
            trailing={model.attention.count === 1 ? "Fix" : model.attention.count}
          />
        </section>
      ) : null}

      <section aria-labelledby="staff-time-destinations-heading">
        <StaffV2SectionLabel id="staff-time-destinations-heading">My time</StaffV2SectionLabel>
        <StaffV2RowGroup ariaLabel="Time sections">
          <StaffV2ListRow
            ariaLabel="Open Attendance history"
            href="/staff/history/records"
            leading={<StaffAppIcon name="clock" />}
            meta="Recent actual attendance"
            title="Attendance history"
          />
          <StaffV2ListRow
            ariaLabel="Open Timesheet and overtime"
            href="/staff/timesheet"
            leading={<StaffAppIcon name="document" />}
            meta={model.timesheet
              ? `${model.timesheet.month} · ${model.timesheet.summary}`
              : "Open monthly work results"}
            title="Timesheet & overtime"
          />
          <StaffV2ListRow
            ariaLabel="Open Attendance corrections"
            href="/staff/history/corrections"
            leading={<StaffAppIcon name="clock" />}
            meta="Requests and approval status"
            title="Attendance corrections"
          />
        </StaffV2RowGroup>
      </section>
    </section>
  );
}

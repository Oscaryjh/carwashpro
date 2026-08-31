import Link from "next/link";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import type { StaffTimeHubModel } from "@/lib/staff-pwa/time-hub";
import {
  StaffV2ActionRow,
  StaffV2ListRow,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  staffV2Styles as styles,
} from "./staff-v2-primitives";
import { StaffTimeHubLegacyRedirect } from "./staff-time-hub-legacy-redirect";

export function StaffTimeHub({ model }: { model: StaffTimeHubModel }) {
  return (
    <section aria-label="Time" className={styles.scope}>
      <StaffTimeHubLegacyRedirect />
      <StaffV2PageHeader
        meta="Today, attendance records and monthly work results."
        title="Time"
      />

      <section aria-labelledby="staff-time-today-heading">
        <StaffV2SectionLabel id="staff-time-today-heading">Today</StaffV2SectionLabel>
        {model.today ? (
          <StaffV2ListRow
            ariaLabel="Open today’s Attendance on Home"
            href="/staff"
            leading={<StaffAppIcon name="clock" />}
            meta={model.today.meta}
            title={model.today.title}
            trailing={<StaffV2StatusBadge tone={model.today.tone}>{model.today.badge}</StaffV2StatusBadge>}
          />
        ) : (
          <div className={styles.inlineError} role="alert">
            <span><strong>Attendance couldn’t load</strong><small>Your other Time sections are still available.</small></span>
            <Link href="/staff/history">Try again</Link>
          </div>
        )}
      </section>

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
            ariaLabel="Open Schedule"
            href="/staff/roster"
            leading={<StaffAppIcon name="calendar" />}
            meta={model.schedule?.summary ?? "Open your published schedule"}
            title="Schedule"
          />
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
        </StaffV2RowGroup>
      </section>
    </section>
  );
}

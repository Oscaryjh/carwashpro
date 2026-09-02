import { CorrectionsLoadingRows } from "@/components/staff-pwa/staff-attendance-corrections-v2";
import {
  StaffV2PageHeader,
  StaffV2SectionLabel,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffAttendanceCorrectionsLoading() {
  return (
    <section aria-label="Loading attendance corrections" className={staffV2Styles.scope}>
      <StaffV2PageHeader
        title="Attendance corrections"
        meta="Track attendance corrections you've submitted."
      />
      <section aria-labelledby="loading-corrections-heading">
        <StaffV2SectionLabel id="loading-corrections-heading">Corrections</StaffV2SectionLabel>
        <CorrectionsLoadingRows />
      </section>
    </section>
  );
}

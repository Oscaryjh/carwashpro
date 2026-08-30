import Image from "next/image";
import type { ReactNode } from "react";
import type { StaffAppIconName } from "@/lib/staff-pwa/appearance-config";

const imageSources: Partial<Record<StaffAppIconName, string>> = {
  "schedule-3d": "/staff-app/icons/schedule.webp",
  "timesheets-3d": "/staff-app/icons/timesheets.webp",
  "leave-3d": "/staff-app/icons/leave.webp",
  "claims-3d": "/staff-app/icons/claims.webp",
  "commission-3d": "/staff-app/icons/commission.webp",
  "payslips-3d": "/staff-app/icons/payslips.webp",
};

const paths: Partial<Record<StaffAppIconName, ReactNode>> = {
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  document: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" /></>,
  leaf: <><path d="M5 20c8 0 14-5 14-15C9 5 5 11 5 20Z" /><path d="M6 18c3-4 6-7 11-10" /></>,
  receipt: <><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  money: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.7-1.9-1-3.2-1-1.8 0-3 .8-3 2.1 0 3.2 6.1 1.6 6.1 4.9 0 1.3-1.2 2.1-3.2 2.1-1.5 0-2.8-.5-3.7-1.4M12 5.5v13" /></>,
  wallet: <><path d="M4 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" /><path d="M16 12h5v4h-5a2 2 0 1 1 0-4Z" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
  sparkle: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.8-4.5 3.3-6.7 7.5-6.7s6.7 2.2 7.5 6.7" /></>,
};

export function StaffAppIcon({ name }: { name: StaffAppIconName }) {
  const imageSource = imageSources[name];
  if (imageSource) {
    return <Image alt="" height={96} src={imageSource} width={96} />;
  }

  return (
    <svg fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name] ?? paths.calendar}
      </g>
    </svg>
  );
}


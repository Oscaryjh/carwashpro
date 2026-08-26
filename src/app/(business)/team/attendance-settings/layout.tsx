import type { ReactNode } from "react";
import { TimeWorkspaceNav } from "@/components/time-workspace-nav";

export default function AttendanceSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TimeWorkspaceNav />
      {children}
    </>
  );
}

"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

const AttendanceCurrentOutlet = createContext<string | undefined>(undefined);

/** Presentation marker only; the server rechecks topology/access and writers
 * independently authorize the original branch or document. */
export function AttendanceOutletProvider({ branchId, children }: { branchId?: string; children: ReactNode }) {
  return <AttendanceCurrentOutlet.Provider value={branchId}>{children}</AttendanceCurrentOutlet.Provider>;
}

export function AttendanceOutletForm({ children, currentOutletGuard = true, ...props }: ComponentProps<"form"> & { currentOutletGuard?: boolean }) {
  const branchId = useContext(AttendanceCurrentOutlet);
  return <form {...props}>
    {currentOutletGuard && branchId && <>
      <input name="attendanceOutletMode" type="hidden" value="single_outlet" />
      <input name="attendanceOutletBranchId" type="hidden" value={branchId} />
    </>}
    {children}
  </form>;
}

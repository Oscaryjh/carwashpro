"use client";

import { useEffect } from "react";
import { useStaffShell } from "./staff-pwa-chrome";

export function StaffTaskNavigation() {
  const { setTaskNavigationHidden } = useStaffShell();

  useEffect(() => {
    setTaskNavigationHidden(true);
    return () => setTaskNavigationHidden(false);
  }, [setTaskNavigationHidden]);

  return null;
}

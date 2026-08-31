"use client";

import { useEffect } from "react";

export function StaffTimeHubLegacyRedirect() {
  useEffect(() => {
    if (window.location.hash === "#attendance-correction") {
      window.location.replace("/staff/history/records#attendance-correction");
    }
  }, []);

  return null;
}

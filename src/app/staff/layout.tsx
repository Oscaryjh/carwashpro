import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { StaffPwaChrome } from "@/components/staff-pwa/staff-pwa-chrome";
import {
  getEmployeeSelfServiceAuthContext,
  getEmployeeWorkplaces,
} from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { loadStaffAppAppearance } from "@/lib/staff-pwa/appearance";
import { canAccessStaffApprovals } from "@/lib/staff-pwa/approval-navigation";
import "./staff.css";
import "./staff-consolidation.css";

export const metadata: Metadata = {
  title: { default: "Tetamu Staff App", template: "%s · Tetamu Staff App" },
  description: "Secure employee self-service for Tetamu workplaces.",
  applicationName: "Tetamu Staff App",
  manifest: "/staff/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Tetamu Staff App" },
  icons: {
    icon: [
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3f8f7",
};

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const auth = await getEmployeeSelfServiceAuthContext();
  const [moduleContext, workplaces, appearance, canApprove] = auth
    ? await Promise.all([
        loadBusinessModuleContext(auth.businessId),
        getEmployeeWorkplaces(auth),
        loadStaffAppAppearance(auth.businessId),
        canAccessStaffApprovals(auth),
      ])
    : [null, [], null, false];
  const modules = moduleContext ? [...moduleContext.enabledModules] : ["CORE"];
  return (
    <StaffPwaChrome appearance={appearance} canApprove={canApprove} enabledModules={modules} workplaces={workplaces}>
      {children}
    </StaffPwaChrome>
  );
}

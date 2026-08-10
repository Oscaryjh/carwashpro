import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { StaffPwaChrome } from "@/components/staff-pwa/staff-pwa-chrome";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import "./staff.css";

export const metadata: Metadata = {
  title: {
    default: "Tetamu Attendance",
    template: "%s · Tetamu Attendance",
  },
  description: "Secure employee attendance, work-location and history access.",
  applicationName: "Tetamu Attendance",
  manifest: "/staff/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tetamu Attendance",
  },
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
  themeColor: "#087f76",
};

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const auth = await getEmployeeSelfServiceAuthContext();
  const modules = auth
    ? [...(await loadBusinessModuleContext(auth.businessId)).enabledModules]
    : ["CORE"];
  return <StaffPwaChrome enabledModules={modules}>{children}</StaffPwaChrome>;
}

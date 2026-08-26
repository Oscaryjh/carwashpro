const configuredStaffAppOrigin = process.env.STAFF_APP_ORIGIN?.trim().replace(/\/+$/, "");
const staffAppOrigin =
  configuredStaffAppOrigin ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3100" : null);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permit phones on the current private Wi-Fi subnet to hydrate the Local
  // development app. This allowlist affects dev-only assets/endpoints only.
  allowedDevOrigins: ["192.168.1.*"],
  // Keep the audited webpack production pipeline while the Next 16 Turbopack
  // prerender path is not yet compatible with this migrated App Router tree.
  turbopack: {},
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "ws",
    "qrcode",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
  async redirects() {
    if (!staffAppOrigin) return [];

    return [
      {
        source: "/staff/:path*",
        destination: `${staffAppOrigin}/staff/:path*`,
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

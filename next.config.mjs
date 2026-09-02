/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permit phones on the current private Wi-Fi subnet to hydrate the Local
  // development app. This allowlist affects dev-only assets/endpoints only.
  allowedDevOrigins: ["127.0.0.1", "192.168.1.*"],
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

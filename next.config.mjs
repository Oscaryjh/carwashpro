import path from "node:path";
import { fileURLToPath } from "node:url";

const chrome87CompatibilityLoader = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "chrome-87-compat-loader.cjs",
);

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
  webpack(config, { isServer }) {
    if (!isServer) {
      config.module.rules.unshift({
        test: /[\\/]next[\\/]dist[\\/]client[\\/]components[\\/](?:catch-error|error-boundary)\.js$/,
        use: [chrome87CompatibilityLoader],
      });
    }

    return config;
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

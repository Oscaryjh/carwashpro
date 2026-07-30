import type { MetadataRoute } from "next";

export function buildStaffManifest(): MetadataRoute.Manifest {
  return {
    name: "Tetamu Attendance",
    short_name: "Attendance",
    description: "Secure employee attendance for Tetamu workplaces.",
    id: "/staff",
    start_url: "/staff",
    scope: "/staff",
    display: "standalone",
    background_color: "#f3f7f6",
    theme_color: "#087f76",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

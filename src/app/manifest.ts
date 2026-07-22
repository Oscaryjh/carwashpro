import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TETAMU POS",
    short_name: "TETAMU POS",
    description:
      "Customer, appointment, cashier, and operations platform for service businesses.",
    start_url: "/cashier",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7f9",
    theme_color: "#0f8279",
    orientation: "any",
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

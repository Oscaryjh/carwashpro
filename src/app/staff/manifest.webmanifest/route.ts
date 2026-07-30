import { NextResponse } from "next/server";
import { buildStaffManifest } from "@/lib/staff-pwa/manifest";

export function GET() {
  return NextResponse.json(buildStaffManifest(), {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/manifest+json",
      "x-content-type-options": "nosniff",
    },
  });
}

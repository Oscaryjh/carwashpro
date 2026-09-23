import { NextResponse } from "next/server";
import { readCanonicalVersion } from "@/lib/release/canonical-version";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = readCanonicalVersion();
  return NextResponse.json(version, {
    status: version.ready ? 200 : 503,
    headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

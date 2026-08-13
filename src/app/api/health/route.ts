import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseIdentity } from "@/lib/release/environment";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = releaseIdentity();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, database: "ready", release: identity },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, database: "unavailable", release: identity },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseIdentity } from "@/lib/release/environment";
import { evaluateWebReadiness } from "@/lib/health/web-readiness";
import { validatePosPilotRuntimeContract } from "@/lib/release/pos-pilot-contract";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = releaseIdentity();
  const readiness = await evaluateWebReadiness({
    databaseProbe: () => prisma.$queryRaw`SELECT 1`,
    runtimeContractProbe: () => validatePosPilotRuntimeContract(),
  });
  return NextResponse.json(
    { ...readiness, release: identity },
    {
      status: readiness.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

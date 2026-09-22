import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseIdentity } from "@/lib/release/environment";
import { evaluateWebReadiness } from "@/lib/health/web-readiness";
import { validatePosPilotRuntimeContract } from "@/lib/release/pos-pilot-contract";
import { assertWhatsAppLiveDeliveryAllowed } from "@/lib/whatsapp/delivery-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = releaseIdentity();
  const readiness = await evaluateWebReadiness({
    databaseProbe: () => prisma.$queryRaw`SELECT 1`,
    runtimeContractProbe: () => {
      validatePosPilotRuntimeContract();
      if (
        process.env.APP_ENVIRONMENT?.trim().toLowerCase() === "production" ||
        process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "production"
      ) {
        assertWhatsAppLiveDeliveryAllowed();
      }
    },
  });
  return NextResponse.json(
    { ...readiness, release: identity },
    {
      status: readiness.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

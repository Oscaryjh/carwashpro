import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import {
  buildPosPilotSmokeAuthorizationResult,
  maintenanceAuditEvent,
  maintenanceSecretMatches,
  resolvePosPilotSmokeConfig,
} from "@/lib/release/pos-pilot-contract";

export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get("x-tetamu-maintenance-token") ?? "";
  let config: ReturnType<typeof resolvePosPilotSmokeConfig>;
  try {
    config = resolvePosPilotSmokeConfig();
  } catch {
    return denied("INVALID_CONFIGURATION");
  }

  if (!(await maintenanceSecretMatches(providedSecret, config.secret))) {
    return denied("INVALID_MAINTENANCE_CREDENTIAL");
  }

  const session = await getSession();
  const result = await buildPosPilotSmokeAuthorizationResult({
    providedSecret,
    session: session
      ? {
          userId: session.userId,
          role: session.role,
          activeBusinessId: session.activeBusinessId,
          branchId: session.branchId ?? null,
        }
      : null,
  });

  if (result.status !== 200) return denied("OPERATOR_OR_SCOPE_DENIED");

  console.info(JSON.stringify(maintenanceAuditEvent({
    event: "SMOKE_ACCEPTED",
    mode: "operator-smoke",
    actorId: session?.userId,
    businessId: session?.activeBusinessId ?? undefined,
    branchId: session?.branchId ?? undefined,
    operation: "AUTHORIZE_OPERATOR_SMOKE",
  })));
  const response = NextResponse.json(result.body, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
  response.cookies.set(result.cookie);
  return response;
}

function denied(reason: string) {
  console.info(JSON.stringify(maintenanceAuditEvent({
    event: "SMOKE_DENIED",
    mode: "operator-smoke",
    operation: "AUTHORIZE_OPERATOR_SMOKE",
    reason,
  })));
  return NextResponse.json(
    { code: "POS_PILOT_WRITE_FROZEN" },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": "60",
      },
    },
  );
}

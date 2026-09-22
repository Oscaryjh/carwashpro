import { NextResponse } from "next/server";

import {
  maintenanceAuditEvent,
  POS_PILOT_SMOKE_COOKIE,
} from "@/lib/release/pos-pilot-contract";

export async function POST() {
  console.info(JSON.stringify(maintenanceAuditEvent({
    event: "MODE_OBSERVED",
    mode: "operator-smoke",
    operation: "REVOKE_OPERATOR_SMOKE",
  })));
  const response = NextResponse.json(
    { revoked: true },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set({
    name: POS_PILOT_SMOKE_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}

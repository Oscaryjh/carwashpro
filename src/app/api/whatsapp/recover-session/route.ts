import { NextResponse } from "next/server";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  getConnectorStatus,
  reconnectConnectorSession,
  type ConnectorStatus,
} from "@/lib/whatsapp/connector-client";

export const runtime = "nodejs";

const RECOVERABLE_STATUSES = new Set<ConnectorStatus["status"]>([
  "disconnected",
  "session_expired",
  "error",
]);

export async function GET() {
  await requireBusinessUser();
  const status = await getConnectorStatus();

  return NextResponse.json({
    ok: true,
    status: status.status,
  });
}

export async function POST() {
  await requireBusinessUser();

  const before = await getConnectorStatus();

  if (!RECOVERABLE_STATUSES.has(before.status)) {
    return NextResponse.json({
      ok: true,
      attempted: false,
      status: before.status,
    });
  }

  await reconnectConnectorSession();
  const after = await getConnectorStatus();

  return NextResponse.json({
    ok: true,
    attempted: true,
    status: after.status,
  });
}

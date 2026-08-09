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
  const { businessId } = await requireBusinessUser("MANAGE_WHATSAPP");
  const status = await getConnectorStatus(businessId);

  return NextResponse.json({
    ok: true,
    status: status.status,
  });
}

export async function POST() {
  const { businessId } = await requireBusinessUser("MANAGE_WHATSAPP");

  const before = await getConnectorStatus(businessId);

  if (!RECOVERABLE_STATUSES.has(before.status)) {
    return NextResponse.json({
      ok: true,
      attempted: false,
      status: before.status,
    });
  }

  await reconnectConnectorSession(businessId);
  const after = await getConnectorStatus(businessId);

  return NextResponse.json({
    ok: true,
    attempted: true,
    status: after.status,
  });
}

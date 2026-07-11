import { NextResponse } from "next/server";

import { requireBusinessUser } from "@/lib/auth/business-user";
import { getWhatsAppConnectorUrl } from "@/lib/whatsapp/connector-client";

export const runtime = "nodejs";

export async function GET() {
  const { businessId } = await requireBusinessUser();
  const url = new URL(`${getWhatsAppConnectorUrl()}/qr/image`);
  url.searchParams.set("businessId", businessId);

  const headers: Record<string, string> = {};
  const secret = process.env.WHATSAPP_CONNECTOR_API_SECRET?.trim();

  if (secret) {
    headers["x-connector-api-secret"] = secret;
  }

  const response = await fetch(url, { headers, cache: "no-store" });

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, error: "QR not available" },
      { status: response.status },
    );
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("content-type") ?? "image/png",
    },
  });
}

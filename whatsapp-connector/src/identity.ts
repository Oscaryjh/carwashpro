import { createHash } from "node:crypto";

export function buildStableProviderMessageId(
  businessId: string,
  requestId: string,
) {
  return createHash("sha256")
    .update(`tetamu-whatsapp:${businessId}:${requestId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

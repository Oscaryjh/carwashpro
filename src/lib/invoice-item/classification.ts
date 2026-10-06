import type { InvoiceItemKind } from "@prisma/client";

/** Identity only: SERVICE does not identify how many units a package covers.
 * Legacy references, names and amounts must never be used to guess identity.
 */
export function resolveInvoiceItemKind(item: { kind: InvoiceItemKind | null }): InvoiceItemKind | "UNKNOWN_LEGACY" {
  return item.kind ?? "UNKNOWN_LEGACY";
}

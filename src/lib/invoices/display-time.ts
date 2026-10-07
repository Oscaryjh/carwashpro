import { DEFAULT_BUSINESS_TIME_ZONE } from "@/lib/business-day";

// Display instants in the owning business zone; never use the host/browser zone.
// Missing legacy settings use the existing canonical Business timezone default.
export function invoiceTimeZone(timezone?: string | null) {
  return timezone || DEFAULT_BUSINESS_TIME_ZONE;
}

export function formatInvoiceDate(value: Date, timezone?: string | null, options?: Intl.DateTimeFormatOptions) {
  return value.toLocaleDateString("en-MY", { ...options, timeZone: invoiceTimeZone(timezone) });
}

export function formatInvoiceTime(value: Date, timezone?: string | null, options?: Intl.DateTimeFormatOptions) {
  return value.toLocaleTimeString("en-MY", { ...options, timeZone: invoiceTimeZone(timezone) });
}

export function formatInvoiceDateTime(value: Date, timezone?: string | null, options?: Intl.DateTimeFormatOptions) {
  return value.toLocaleString("en-MY", { ...options, timeZone: invoiceTimeZone(timezone) });
}

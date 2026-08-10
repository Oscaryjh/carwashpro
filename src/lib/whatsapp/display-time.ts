import {
  addDaysToDateValue,
  BUSINESS_TIME_ZONE,
  formatDateValue,
  toBusinessDateValue,
} from "@/lib/business-time";

const whatsappTimeFormatter = new Intl.DateTimeFormat("en-MY", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

export function formatWhatsAppConversationTime(
  date: Date,
  now = new Date(),
) {
  const dateValue = toBusinessDateValue(date);
  const todayValue = toBusinessDateValue(now);

  if (dateValue === todayValue) {
    return formatWhatsAppMessageTime(date);
  }

  if (addDaysToDateValue(dateValue, 1) === todayValue) {
    return "Yesterday";
  }

  return formatDateValue(dateValue, {
    day: "numeric",
    month: "short",
  });
}

export function formatWhatsAppMessageTime(date: Date) {
  return whatsappTimeFormatter.format(date);
}

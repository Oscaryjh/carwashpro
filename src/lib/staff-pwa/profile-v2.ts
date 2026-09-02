const DATE_FORMATTER = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-MY", {
  hour: "numeric",
  minute: "2-digit",
});

export function formatProfileDate(value: string) {
  const date = parseProfileDate(value);
  return date ? DATE_FORMATTER.format(date) : null;
}

export function formatProfileActivity(value: string, now = new Date()) {
  const date = parseProfileDate(value);
  if (!date) return null;

  const day = localDayNumber(date);
  const today = localDayNumber(now);
  const prefix = day === today
    ? "Today"
    : day === today - 1
      ? "Yesterday"
      : DATE_FORMATTER.format(date);
  return `${prefix}, ${TIME_FORMATTER.format(date)}`;
}

export function humanizeProfileValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function safeDevicePlatform(value: string | null) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("iphone") || normalized === "ios") return "iPhone";
  if (normalized.includes("ipad")) return "iPad";
  if (normalized.includes("android")) return "Android";
  if (normalized.includes("mac")) return "macOS";
  if (normalized.includes("win")) return "Windows";
  if (normalized.includes("cros")) return "Chrome OS";
  if (normalized.includes("linux")) return "Linux";
  return null;
}

export function safeDeviceBrowser(value: string | null) {
  if (!value) return null;
  const allowed = new Set([
    "Browser",
    "Chrome",
    "Chrome iOS",
    "Edge",
    "Firefox",
    "Firefox iOS",
    "Safari",
  ]);
  return allowed.has(value) ? value : null;
}

function parseProfileDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayNumber(value: Date) {
  return Math.floor(new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime() / 86_400_000);
}

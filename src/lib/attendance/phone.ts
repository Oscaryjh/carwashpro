const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;
const PHONE_INPUT_PATTERN = /^[+\d\s()-]+$/;
const PHONE_FORMATTING_PATTERN = /[\s()-]/g;

export function normalizeAttendancePhone(value: string) {
  const trimmed = value.trim();

  if (!trimmed || !PHONE_INPUT_PATTERN.test(trimmed)) {
    return null;
  }

  const compact = trimmed.replace(PHONE_FORMATTING_PATTERN, "");

  if (!/^\+?\d+$/.test(compact)) {
    return null;
  }

  const hasInternationalPrefix = compact.startsWith("+");
  let digits = hasInternationalPrefix ? compact.slice(1) : compact;

  if (!hasInternationalPrefix && digits.startsWith("00")) {
    return null;
  }

  if (!hasInternationalPrefix && digits.startsWith("0")) {
    digits = `60${digits.slice(1)}`;
  }

  if (
    !/^[1-9]\d*$/.test(digits) ||
    digits.length < E164_MIN_DIGITS ||
    digits.length > E164_MAX_DIGITS
  ) {
    return null;
  }

  return `+${digits}`;
}

export function assertAttendancePhone(value: string) {
  const normalized = normalizeAttendancePhone(value);

  if (!normalized) {
    throw new Error("Enter a valid phone number.");
  }

  return normalized;
}

export function normalizeAttendancePhoneLastFour(value: string) {
  const trimmed = value.trim();

  return /^\d{4}$/.test(trimmed) ? trimmed : null;
}

export function maskAttendancePhone(value: string) {
  const normalized = normalizeAttendancePhone(value);

  if (!normalized) {
    return null;
  }

  const digits = normalized.slice(1);
  if (digits.startsWith("60")) {
    const subscriber = digits.slice(2);
    const prefixLength = Math.min(2, Math.max(1, subscriber.length - 5));
    const prefix = subscriber.slice(0, prefixLength);
    const suffix = subscriber.slice(-4);
    const hiddenLength = subscriber.length - prefix.length - suffix.length;

    return `+60 ${prefix}-${"*".repeat(hiddenLength)} ${suffix}`;
  }

  const prefixLength = Math.min(3, Math.max(1, digits.length - 5));
  const prefix = digits.slice(0, prefixLength);
  const suffix = digits.slice(-4);
  const hiddenLength = digits.length - prefix.length - suffix.length;

  return `+${prefix}-${"*".repeat(hiddenLength)} ${suffix}`;
}

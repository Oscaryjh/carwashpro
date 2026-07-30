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

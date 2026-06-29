const ENCODED_TEXT_PREFIX = "wf:utf8:";

export function encodeWhatsAppStoredText(value: string | null | undefined) {
  const cleaned = sanitizeWhatsAppText(value);

  if (!cleaned) {
    return null;
  }

  if (/^[\x00-\x7F]*$/.test(cleaned)) {
    return cleaned;
  }

  return `${ENCODED_TEXT_PREFIX}${Buffer.from(cleaned, "utf8").toString("base64")}`;
}

export function decodeWhatsAppStoredText(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  if (!value.startsWith(ENCODED_TEXT_PREFIX)) {
    return value;
  }

  try {
    return Buffer.from(value.slice(ENCODED_TEXT_PREFIX.length), "base64").toString(
      "utf8",
    );
  } catch {
    return value;
  }
}

function sanitizeWhatsAppText(value: string | null | undefined) {
  return (
    value
      ?.normalize("NFC")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

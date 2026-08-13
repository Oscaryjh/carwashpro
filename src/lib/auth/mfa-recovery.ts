import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECOVERY_RAW_LENGTH = 12;
const RECOVERY_HASH_ROUNDS = 12;

export function generateRecoveryCodes() {
  const values = new Set<string>();
  while (values.size < RECOVERY_CODE_COUNT) {
    values.add(formatRecoveryCode(randomRecoveryValue()));
  }
  return [...values];
}

export async function hashRecoveryCodes(codes: readonly string[]) {
  return Promise.all(
    codes.map(async (code, index) => ({
      ordinal: index + 1,
      codeHash: await bcrypt.hash(normalizeRecoveryCode(code), RECOVERY_HASH_ROUNDS),
    })),
  );
}

export async function recoveryCodeMatches(code: string, codeHash: string) {
  const normalized = normalizeRecoveryCode(code);
  if (!/^[2-9A-HJ-NP-Z]{12}$/.test(normalized)) return false;
  return bcrypt.compare(normalized, codeHash);
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
}

function randomRecoveryValue() {
  const bytes = randomBytes(RECOVERY_RAW_LENGTH);
  let value = "";
  for (const byte of bytes) {
    value += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  }
  return value;
}

function formatRecoveryCode(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

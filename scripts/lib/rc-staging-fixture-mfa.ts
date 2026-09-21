import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, statSync, realpathSync, renameSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { authenticatePasswordLogin } from "../../src/lib/auth/password-login";
import { persistSessionContext } from "../../src/lib/auth/session";
import { beginMfaEnrollment, completeMfaEnrollment, regenerateRecoveryCodes } from "../../src/lib/auth/mfa-service";
import { generateTotpCode } from "../../src/lib/auth/mfa-totp";
import { verifySensitiveActionMfa } from "../../src/lib/auth/sensitive-action-service";
import { getSensitiveActionPolicy, type SensitiveActionKey } from "../../src/lib/auth/sensitive-actions";
import { confirmManualPcb, manualPcbInputDigest } from "../../src/lib/payroll/manual-pcb-service";

// Called only within the exclusive guarded installation/resume. No test-issued
// authorization tokens, bypass flags, fixed OTPs or weakened MFA policy.
const authorizers = new Map<string, ReturnType<typeof enrollStagingAuthorizer>>();
export function clearStagingAuthorizerCache() {
  authorizers.clear();
}
export function readStagingCredentialHandoff() {
  const path = process.env.RC_STAGING_FIXTURE_SECRET_FILE;
  if (!path) throw new Error("RC_STAGING_FIXTURE_MFA_HANDOFF_REQUIRED");
  const actual = realpathSync(path);
  if (actual.startsWith(resolve(import.meta.dirname, "../..") + sep) || !statSync(actual).isFile() || (statSync(actual).mode & 0o777) !== 0o600) throw new Error("RC_STAGING_FIXTURE_MFA_HANDOFF_REJECTED");
  return { path: actual, data: JSON.parse(readFileSync(actual, "utf8")) };
}
export async function createStagingAuthorizer(prisma: PrismaClient, businessId: string, userId: string, password: string) {
  const key = `${businessId}:${userId}`;
  if (!authorizers.has(key)) authorizers.set(key, enrollStagingAuthorizer(prisma, businessId, userId, password));
  return authorizers.get(key)!;
}
async function enrollStagingAuthorizer(prisma: PrismaClient, businessId: string, userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email) throw new Error("RC_STAGING_FIXTURE_ACTOR_INVALID");
  const request = { ipAddress: "127.0.0.1", userAgent: "RC Staging synthetic provisioning" };
  const login = await authenticatePasswordLogin({ email: user.email, password, request }, { database: prisma });
  if (!login.ok || login.user.id !== user.id) throw new Error("RC_STAGING_FIXTURE_PASSWORD_LOGIN_REJECTED");
  const session = await persistSessionContext({ userId, sessionId: randomUUID(), homeBusinessId: user.businessId,
    activeBusinessId: businessId, contextVersion: 1, branchId: user.branchId,
    name: user.name, email: user.email, role: user.role, permissions: user.permissions, status: user.status }, { database: prisma, request });
  const active = await prisma.userMfaCredential.findFirst({ where: { userId, type: "TOTP", status: "ACTIVE", revokedAt: null } });
  let recoveryCodes: string[];
  if (active) {
    const { data: secrets } = readStagingCredentialHandoff();
    const existingSecret = secrets.mfa?.[userId];
    if (typeof existingSecret !== "string" || existingSecret.length < 16) throw new Error("RC_STAGING_FIXTURE_MFA_HANDOFF_REJECTED");
    const periodMs = active.periodSeconds * 1_000;
    const currentCounter = Math.floor(Date.now() / periodMs);
    const lastAcceptedCounter = active.lastAcceptedCounter === null ? null : Number(active.lastAcceptedCounter);
    if (lastAcceptedCounter !== null && currentCounter <= lastAcceptedCounter) {
      await new Promise((resolve) => setTimeout(resolve, (lastAcceptedCounter + 1) * periodMs - Date.now() + 50));
    }
    recoveryCodes = (await regenerateRecoveryCodes({ userId, sessionId: session.id, password,
      factor: { factorType: "TOTP", code: generateTotpCode({ secret: existingSecret, timestamp: Date.now() }) }, request }, { database: prisma })).recoveryCodes;
  } else {
    const pending = await beginMfaEnrollment({ userId, sessionId: session.id, password, request }, { database: prisma });
    recoveryCodes = (await completeMfaEnrollment({ userId, sessionId: session.id, credentialId: pending.credential.id,
      code: generateTotpCode({ secret: pending.manualSecret, timestamp: Date.now() }), request }, { database: prisma })).recoveryCodes;
    // Only the Owner-controlled, worktree-external 0600 handoff may retain the
    // synthetic TOTP enrollment. Never log it or put it in fixture audit metadata.
    const { path: actual, data: secrets } = readStagingCredentialHandoff();
    secrets.mfa = { ...secrets.mfa, [userId]: pending.manualSecret };
    const temporary = `${actual}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(secrets), { mode: 0o600, flag: "wx" });
    renameSync(temporary, actual);
  }
  let index = 0;
  const authorize = async (actionKey: SensitiveActionKey, resourceId: string) => {
    const code = recoveryCodes[index++];
    if (!code) throw new Error("RC_STAGING_FIXTURE_MFA_RECOVERY_EXHAUSTED");
    const result = await verifySensitiveActionMfa({ actionKey, resourceId, resourceType: getSensitiveActionPolicy(actionKey).resourceType,
      businessId, userId, sessionId: session.id, password, factor: { factorType: "RECOVERY_CODE", code }, request }, { database: prisma });
    return { rawToken: result.rawToken, sessionId: session.id };
  };
  return { authorize, async confirm(entryId: string, amount: string, externalReference: string) {
    const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { id: entryId, businessId } });
    return confirmManualPcb({ businessId, entryId, actorId: userId, amount, externalReference, confirmed: true,
      expectedRevision: entry.calculationRevision, expectedInputDigest: await manualPcbInputDigest(prisma, businessId, entryId),
      stepUp: await authorize("PCB_MANUAL_CONFIRM", entryId) }, prisma);
  } };
}

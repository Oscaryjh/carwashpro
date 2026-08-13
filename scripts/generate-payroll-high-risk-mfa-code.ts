import { PrismaClient } from "@prisma/client";
import { decryptMfaSecret } from "../src/lib/auth/mfa-crypto";
import { generateTotpCode, TOTP_PERIOD_SECONDS } from "../src/lib/auth/mfa-totp";

const QA_APPROVER_EMAIL = "commission-browser-approver@test.local";
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";

process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;
const prisma = new PrismaClient();

async function main() {
  assertLocalDatabase();
  const credential = await prisma.userMfaCredential.findFirstOrThrow({
    where: {
      user: { email: QA_APPROVER_EMAIL },
      type: "TOTP",
      status: "ACTIVE",
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
  let timestamp = Date.now();
  let counter = BigInt(Math.floor(timestamp / (TOTP_PERIOD_SECONDS * 1000)));
  if (credential.lastAcceptedCounter !== null && counter <= credential.lastAcceptedCounter) {
    const nextCounterAt = (Number(credential.lastAcceptedCounter) + 1) * TOTP_PERIOD_SECONDS * 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextCounterAt - timestamp + 250)));
    timestamp = Date.now();
    counter = BigInt(Math.floor(timestamp / (TOTP_PERIOD_SECONDS * 1000)));
  }
  if (credential.lastAcceptedCounter !== null && counter <= credential.lastAcceptedCounter) {
    throw new Error("QA_TOTP_COUNTER_DID_NOT_ADVANCE");
  }
  const secret = decryptMfaSecret({
    credentialId: credential.id,
    userId: credential.userId,
    type: "TOTP",
    encryptedSecret: credential.encryptedSecret,
    secretIv: credential.secretIv,
    secretAuthTag: credential.secretAuthTag,
    encryptionKeyVersion: credential.encryptionKeyVersion,
  });
  process.stdout.write(generateTotpCode({ secret, timestamp }));
}

function assertLocalDatabase() {
  const hostname = new URL(process.env.DATABASE_URL!).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

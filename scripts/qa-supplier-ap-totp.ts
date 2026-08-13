import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { decryptMfaSecret } = await import("../src/lib/auth/mfa-crypto");
  const { generateTotpCode } = await import("../src/lib/auth/mfa-totp");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("QA TOTP helper requires a Local database.");
  const credential = await prisma.userMfaCredential.findFirstOrThrow({ where: { user: { email: "ap-e2e@test.local" }, type: "TOTP", status: "ACTIVE" }, include: { user: { select: { id: true } } } });
  const secret = decryptMfaSecret({ credentialId: credential.id, userId: credential.user.id, type: "TOTP", encryptedSecret: credential.encryptedSecret, secretIv: credential.secretIv, secretAuthTag: credential.secretAuthTag, encryptionKeyVersion: credential.encryptionKeyVersion });
  console.log(generateTotpCode({ secret, timestamp: Date.now() }));
  await prisma.$disconnect();
}

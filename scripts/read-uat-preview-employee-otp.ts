import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import { deriveUatPreviewOtp } from "@/lib/attendance/employee-auth/uat-preview-otp";

const CHALLENGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_PROVIDER_MARKER = "UAT_PREVIEW_INTERCEPT_V1";

async function main() {
  const challengeId = readChallengeId(process.argv.slice(2));

  // The complete Preview OTP contract is evaluated before Prisma is imported or
  // instantiated. A wrong runtime, Railway identity, restricted flag, real SMS
  // credential, or missing secret therefore cannot result in database access.
  const config = getEmployeeAuthConfig(process.env);
  if (
    config.environment !== "uat-preview" ||
    config.otp.provider !== "uat_preview_intercept" ||
    !config.otp.uatPreview
  ) {
    throw new Error("UAT_PREVIEW_OTP_HELPER_CONFIGURATION_REJECTED");
  }

  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();

  try {
    const challenge = await database.employeeOtpChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        phoneNumberNormalized: true,
        expiresAt: true,
        provider: true,
        providerMessageCode: true,
        providerReference: true,
        verifiedAt: true,
        invalidatedAt: true,
      },
    });
    if (
      !challenge ||
      challenge.provider !== "mock" ||
      challenge.providerMessageCode !== PREVIEW_PROVIDER_MARKER ||
      !challenge.providerReference?.startsWith(
        `uat-preview:v1:${challenge.id}:`,
      ) ||
      challenge.verifiedAt ||
      challenge.invalidatedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      !config.otp.uatPreview.syntheticPhoneAllowlist.includes(
        challenge.phoneNumberNormalized,
      )
    ) {
      throw new Error("UAT_PREVIEW_OTP_CHALLENGE_REJECTED");
    }

    process.stdout.write(
      `${deriveUatPreviewOtp(
        {
          challengeId: challenge.id,
          phoneNumber: challenge.phoneNumberNormalized,
          expiresAt: challenge.expiresAt,
        },
        config.otp.uatPreview.hmacSeed,
      )}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

function readChallengeId(arguments_: string[]) {
  const optionIndex = arguments_.indexOf("--challenge-id");
  const challengeId = arguments_[optionIndex + 1]?.trim() ?? "";
  if (
    optionIndex < 0 ||
    arguments_.length !== 2 ||
    !CHALLENGE_ID_PATTERN.test(challengeId)
  ) {
    throw new Error("UAT_PREVIEW_OTP_CHALLENGE_ID_REQUIRED");
  }
  return challengeId;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && /^UAT_PREVIEW_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "UAT_PREVIEW_OTP_HELPER_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

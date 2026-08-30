import { createHmac, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { EmployeeAuthConfig } from "./config";
import { getEmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";

const SELECTION_TOKEN_ISSUER = "tetamu-employee-auth";
const SELECTION_TOKEN_AUDIENCE = "tetamu-membership-selection";

export type EmployeeMembershipSelectionClaims = Readonly<{
  challengeId: string;
  employeeAccountId: string;
  deviceFingerprintHash: string;
}>;

export async function createEmployeeMembershipSelectionToken(
  claims: EmployeeMembershipSelectionClaims,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  return new SignJWT({
    challengeId: requiredClaim(claims.challengeId, "challengeId"),
    employeeAccountId: requiredClaim(
      claims.employeeAccountId,
      "employeeAccountId",
    ),
    deviceFingerprintHash: requiredClaim(
      claims.deviceFingerprintHash,
      "deviceFingerprintHash",
    ),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SELECTION_TOKEN_ISSUER)
    .setAudience(SELECTION_TOKEN_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${config.session.selectionExpiresInSeconds}s`)
    .sign(selectionKey(config.authSecret));
}

export async function verifyEmployeeMembershipSelectionToken(
  token: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
): Promise<EmployeeMembershipSelectionClaims> {
  try {
    const verified = await jwtVerify(
      token,
      selectionKey(config.authSecret),
      {
        algorithms: ["HS256"],
        audience: SELECTION_TOKEN_AUDIENCE,
        issuer: SELECTION_TOKEN_ISSUER,
      },
    );

    return {
      challengeId: requiredClaim(
        verified.payload.challengeId,
        "challengeId",
      ),
      employeeAccountId: requiredClaim(
        verified.payload.employeeAccountId,
        "employeeAccountId",
      ),
      deviceFingerprintHash: requiredClaim(
        verified.payload.deviceFingerprintHash,
        "deviceFingerprintHash",
      ),
    };
  } catch (error) {
    if (
      error instanceof EmployeeAuthError &&
      error.code === "OTP_INVALID"
    ) {
      throw error;
    }

    throw new EmployeeAuthError(
      "OTP_INVALID",
      "Membership selection token is invalid or expired.",
      { cause: error },
    );
  }
}

function selectionKey(secret: string) {
  return createHmac("sha256", secret)
    .update("tetamu:employee-auth:v1\0membership-selection")
    .digest();
}

function requiredClaim(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EmployeeAuthError(
      "OTP_INVALID",
      `Membership selection token is missing ${name}.`,
    );
  }

  return value;
}

import { jwtVerify, SignJWT } from "jose";

const CONTEXT_TOKEN_AUDIENCE = "business-context";

export type BusinessContextIdentity = {
  userId: string;
  businessId: string;
  contextVersion: number;
};

export type BusinessContextTokenResult =
  | { valid: true }
  | {
      valid: false;
      code: "INVALID_CONTEXT_TOKEN" | "BUSINESS_CONTEXT_CHANGED";
      message: string;
    };

export async function createBusinessContextToken(
  context: BusinessContextIdentity,
) {
  return new SignJWT({
    businessId: context.businessId,
    contextVersion: context.contextVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(context.userId)
    .setAudience(CONTEXT_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyBusinessContextToken(
  token: string,
  current: BusinessContextIdentity,
): Promise<BusinessContextTokenResult> {
  try {
    const verified = await jwtVerify(token, getSecret(), {
      audience: CONTEXT_TOKEN_AUDIENCE,
    });
    const tokenBusinessId =
      typeof verified.payload.businessId === "string"
        ? verified.payload.businessId
        : null;
    const tokenContextVersion =
      typeof verified.payload.contextVersion === "number"
        ? verified.payload.contextVersion
        : null;

    if (
      verified.payload.sub !== current.userId ||
      tokenBusinessId !== current.businessId ||
      tokenContextVersion !== current.contextVersion
    ) {
      return contextChanged();
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      code: "INVALID_CONTEXT_TOKEN",
      message: "This page context is invalid. Refresh the page and try again.",
    };
  }
}

function contextChanged(): BusinessContextTokenResult {
  return {
    valid: false,
    code: "BUSINESS_CONTEXT_CHANGED",
    message:
      "The active business changed in another tab. Refresh this page before submitting.",
  };
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }

  return new TextEncoder().encode(secret);
}

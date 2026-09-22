import { jwtVerify, SignJWT } from "jose";

export const POS_PILOT_SMOKE_COOKIE = "tetamu_pos_pilot_smoke" as const;
export const POS_PILOT_SMOKE_TTL_SECONDS = 600;

const ISSUER = "tetamu-pos-pilot-write-freeze";
const AUDIENCE = "tetamu-pos-pilot-operator-smoke";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SMOKE_OPERATIONS = new Set([
  "APPOINTMENT_CREATE",
  "APPOINTMENT_UPDATE",
  "APPOINTMENT_CANCEL",
  "WORK_ORDER_CREATE",
  "WORK_ORDER_UPDATE",
  "POS_CHECKOUT",
  "POS_PAYMENT",
  "POS_REFUND",
  "POS_PACKAGE_REDEMPTION",
  "POS_DAILY_CLOSING_START",
  "POS_DAILY_CLOSING_END",
  "POS_DAILY_CLOSING_FINALIZE",
]);

type RuntimeEnv = Record<string, string | undefined>;

export type PosPilotSmokeScope = Readonly<{
  actorId: string;
  businessId: string;
  branchId: string;
}>;

export function resolvePosPilotSmokeConfig(env: RuntimeEnv = process.env) {
  const explicit = env.APP_ENVIRONMENT?.trim().toLowerCase();
  const railway = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  if (
    (explicit && explicit !== "production") ||
    (railway && railway !== "production") ||
    env.POS_PILOT_RELEASE_MODE !== "core-pilot" ||
    env.POS_PILOT_WRITE_FREEZE_MODE !== "operator-smoke"
  ) {
    throw new Error("Production core-pilot operator-smoke configuration is required.");
  }

  const secret = env.POS_PILOT_SMOKE_SECRET ?? "";
  if (new TextEncoder().encode(secret).byteLength < 48) {
    throw new Error("POS_PILOT_SMOKE_SECRET must contain at least 48 bytes.");
  }

  const actorId = requiredUuid(env.POS_PILOT_SMOKE_OPERATOR_USER_ID, "POS_PILOT_SMOKE_OPERATOR_USER_ID");
  const businessId = requiredUuid(env.POS_PILOT_SMOKE_BUSINESS_ID, "POS_PILOT_SMOKE_BUSINESS_ID");
  const branchId = requiredUuid(env.POS_PILOT_SMOKE_BRANCH_ID, "POS_PILOT_SMOKE_BRANCH_ID");

  return {
    actorId,
    businessId,
    branchId,
    secret,
    ttlSeconds: POS_PILOT_SMOKE_TTL_SECONDS,
  } as const;
}

export async function maintenanceSecretMatches(provided: string, expected: string) {
  if (!provided || !expected) return false;
  const [providedDigest, expectedDigest] = await Promise.all([
    digest(provided),
    digest(expected),
  ]);
  let difference = 0;
  for (let index = 0; index < providedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}

export async function issuePosPilotSmokeCapability(input: PosPilotSmokeScope & {
  secret: string;
  nowSeconds?: number;
}) {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return new SignJWT({
    businessId: input.businessId,
    branchId: input.branchId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(input.actorId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + POS_PILOT_SMOKE_TTL_SECONDS)
    .sign(secretKey(input.secret));
}

export async function verifyPosPilotSmokeCapability(input: {
  token: string;
  secret: string;
  nowSeconds?: number;
}): Promise<PosPilotSmokeScope | null> {
  if (!input.token || !input.secret) return null;
  try {
    const verified = await jwtVerify(input.token, secretKey(input.secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 0,
      currentDate: new Date((input.nowSeconds ?? Math.floor(Date.now() / 1000)) * 1000),
    });
    const actorId = verified.payload.sub;
    const businessId = verified.payload.businessId;
    const branchId = verified.payload.branchId;
    if (
      typeof actorId !== "string" ||
      typeof businessId !== "string" ||
      typeof branchId !== "string"
    ) {
      return null;
    }
    return { actorId, businessId, branchId };
  } catch {
    return null;
  }
}

export function posPilotSmokeScopeMatches(
  capability: PosPilotSmokeScope,
  actual: PosPilotSmokeScope,
) {
  return capability.actorId === actual.actorId &&
    capability.businessId === actual.businessId &&
    capability.branchId === actual.branchId;
}

export async function authorizePosPilotSmoke(input: {
  providedSecret: string;
  session: {
    userId: string;
    role: string;
    activeBusinessId: string | null;
    branchId: string | null;
  } | null;
  env?: RuntimeEnv;
  nowSeconds?: number;
}) {
  const config = resolvePosPilotSmokeConfig(input.env);
  const secretValid = await maintenanceSecretMatches(
    input.providedSecret,
    config.secret,
  );
  const actualScope = input.session
    ? {
        actorId: input.session.userId,
        businessId: input.session.activeBusinessId ?? "",
        branchId: input.session.branchId ?? "",
      }
    : null;
  if (
    !secretValid ||
    !input.session ||
    input.session.role !== "BUSINESS_OWNER" ||
    !actualScope ||
    !posPilotSmokeScopeMatches(config, actualScope)
  ) {
    throw new Error("POS_PILOT_WRITE_FROZEN");
  }

  const token = await issuePosPilotSmokeCapability({
    ...actualScope,
    secret: config.secret,
    nowSeconds: input.nowSeconds,
  });
  return {
    token,
    maxAge: config.ttlSeconds,
    scope: actualScope,
  } as const;
}

export async function buildPosPilotSmokeAuthorizationResult(
  input: Parameters<typeof authorizePosPilotSmoke>[0],
) {
  try {
    const authorized = await authorizePosPilotSmoke(input);
    return {
      status: 200 as const,
      body: {
        authorized: true as const,
        expiresInSeconds: POS_PILOT_SMOKE_TTL_SECONDS,
      },
      cookie: {
        name: POS_PILOT_SMOKE_COOKIE,
        value: authorized.token,
        httpOnly: true as const,
        secure: true as const,
        sameSite: "strict" as const,
        path: "/" as const,
        maxAge: POS_PILOT_SMOKE_TTL_SECONDS,
      },
    };
  } catch {
    return {
      status: 503 as const,
      body: { code: "POS_PILOT_WRITE_FROZEN" as const },
    };
  }
}

export async function authorizePosPilotSmokeOperation(input: {
  operation: string;
  capabilityToken?: string;
  env?: RuntimeEnv;
  nowSeconds?: number;
}): Promise<PosPilotSmokeScope | null> {
  const env = input.env ?? process.env;
  const rawMode = env.POS_PILOT_WRITE_FREEZE_MODE;
  const environment = env.APP_ENVIRONMENT?.trim().toLowerCase() ||
    env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ||
    env.NODE_ENV?.trim().toLowerCase() ||
    "development";
  if (!rawMode && environment !== "production" && env.POS_PILOT_RELEASE_MODE !== "core-pilot") {
    return null;
  }
  if (rawMode === "off") return null;
  if (rawMode !== "operator-smoke" || !SMOKE_OPERATIONS.has(input.operation)) {
    throw new Error("POS_PILOT_WRITE_FROZEN");
  }

  const config = resolvePosPilotSmokeConfig(env);
  const capability = await verifyPosPilotSmokeCapability({
    token: input.capabilityToken ?? "",
    secret: config.secret,
    nowSeconds: input.nowSeconds,
  });
  if (!capability || !posPilotSmokeScopeMatches(config, capability)) {
    throw new Error("POS_PILOT_WRITE_FROZEN");
  }
  return capability;
}

export function assertPosPilotSmokeOperationScope(
  capability: PosPilotSmokeScope | null,
  actual: PosPilotSmokeScope,
) {
  if (capability && !posPilotSmokeScopeMatches(capability, actual)) {
    throw new Error("POS_PILOT_WRITE_FROZEN");
  }
}

function requiredUuid(value: string | undefined, name: string) {
  if (!value || !UUID.test(value)) throw new Error(`${name} must be a UUID.`);
  return value;
}

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

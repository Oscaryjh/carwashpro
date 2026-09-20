import { NextResponse, type NextRequest } from "next/server";
import {
  parseRuntimeEnvironment as runtimeEnvironment,
  type RuntimeEnvironmentMap,
} from "./environment-contract.mjs";

export type UatPreviewAccessDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; response: NextResponse }>;

const ACCESS_REALM = "TETAMU UAT Preview";

export async function evaluateUatPreviewAccess(
  request: NextRequest,
  env: RuntimeEnvironmentMap = process.env,
): Promise<UatPreviewAccessDecision> {
  if (isUatPreviewAccessExemptPath(request.nextUrl.pathname)) {
    return { allowed: true };
  }

  let environment;
  try {
    environment = runtimeEnvironment(env);
  } catch {
    return unavailable();
  }
  if (environment !== "uat-preview") {
    return { allowed: true };
  }

  const username = env.UAT_PREVIEW_ACCESS_USERNAME?.trim() ?? "";
  const password = env.UAT_PREVIEW_ACCESS_PASSWORD?.trim() ?? "";
  if (
    env.UAT_PREVIEW_ACCESS_ENABLED?.trim().toLowerCase() !== "true" ||
    username.length < 3 ||
    new TextEncoder().encode(password).byteLength < 32
  ) {
    return unavailable();
  }

  const credentials = parseBasicAuthorization(
    request.headers.get("authorization"),
  );
  const [usernameMatches, passwordMatches] = await Promise.all([
    constantTimeTextEqual(credentials?.username ?? "", username),
    constantTimeTextEqual(credentials?.password ?? "", password),
  ]);
  if (!credentials || !usernameMatches || !passwordMatches) {
    return unauthorized();
  }

  return { allowed: true };
}

export function isUatPreviewAccessExemptPath(pathname: string) {
  return (
    pathname === "/api/health" ||
    pathname.startsWith("/api/health/") ||
    pathname === "/_next/static" ||
    pathname.startsWith("/_next/static/") ||
    pathname === "/_next/image" ||
    pathname.startsWith("/_next/image/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/staff/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/pwa" ||
    pathname.startsWith("/pwa/")
  );
}

function parseBasicAuthorization(value: string | null) {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(value ?? "");
  if (!match || match[1].length % 4 !== 0) return null;

  let decoded: string;
  try {
    const binary = atob(match[1]);
    if (btoa(binary) !== match[1]) return null;
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator < 1) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

async function constantTimeTextEqual(actual: string, expected: string) {
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function unauthorized(): UatPreviewAccessDecision {
  return {
    allowed: false,
    response: new NextResponse("UAT Preview access required.", {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": `Basic realm="${ACCESS_REALM}", charset="UTF-8"`,
      },
    }),
  };
}

function unavailable(): UatPreviewAccessDecision {
  return {
    allowed: false,
    response: new NextResponse("UAT Preview access unavailable.", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    }),
  };
}

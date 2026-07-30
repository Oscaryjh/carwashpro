import type { z } from "zod";
import { getEmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";

export type EmployeeAuthRequestContext = Readonly<{
  ipAddress: string | null;
  userAgent: string | null;
}>;

export function assertEmployeeAuthSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (fetchSite === "cross-site") {
    throw new EmployeeAuthError("INVALID_REQUEST", "Cross-site request denied.");
  }

  const origin = request.headers.get("origin");

  if (!origin) {
    return;
  }

  let requestOrigin: string;
  let suppliedOrigin: string;

  try {
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host")?.trim();
    requestOrigin = requestHost
      ? new URL(`${requestUrl.protocol}//${requestHost}`).origin
      : requestUrl.origin;
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new EmployeeAuthError("INVALID_REQUEST", "Invalid request origin.");
  }

  if (requestOrigin !== suppliedOrigin) {
    throw new EmployeeAuthError("INVALID_REQUEST", "Cross-site request denied.");
  }
}

export async function readEmployeeAuthJson<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  maximumBytes = getEmployeeAuthConfig().maxJsonBodyBytes,
): Promise<z.output<TSchema>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    throw new EmployeeAuthError(
      "INVALID_REQUEST",
      "Content-Type must be application/json.",
    );
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength) {
    const parsedLength = Number(contentLength);

    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      throw new EmployeeAuthError("INVALID_REQUEST", "Request body is too large.", {
        status: 413,
      });
    }
  }

  const payload = await readLimitedBody(request, maximumBytes);
  let json: unknown;

  try {
    json = JSON.parse(payload);
  } catch {
    throw new EmployeeAuthError("INVALID_REQUEST", "Request body is not valid JSON.");
  }

  const parsed = schema.safeParse(json);

  if (!parsed.success) {
    throw new EmployeeAuthError("INVALID_REQUEST", "Request body is invalid.");
  }

  return parsed.data;
}

export function getEmployeeAuthRequestContext(
  request: Request,
): EmployeeAuthRequestContext {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null;
  const userAgent = request.headers.get("user-agent")?.trim() || null;

  return {
    ipAddress: ipAddress?.slice(0, 128) ?? null,
    userAgent: userAgent?.slice(0, 512) ?? null,
  };
}

async function readLimitedBody(request: Request, maximumBytes: number) {
  if (!request.body) {
    throw new EmployeeAuthError("INVALID_REQUEST", "Request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new EmployeeAuthError("INVALID_REQUEST", "Request body is too large.", {
        status: 413,
      });
    }

    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

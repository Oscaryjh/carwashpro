import { timingSafeEqual } from "node:crypto";

export type ConnectorAuthorization =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; status: 401 | 503; error: string }>;

export function authorizeConnectorRequest(
  suppliedSecret: string | undefined,
  configuredSecret: string | undefined,
): ConnectorAuthorization {
  const expected = configuredSecret?.trim();
  if (!expected) {
    return {
      error: "Connector API authentication is not configured.",
      ok: false,
      status: 503,
    };
  }

  const supplied = suppliedSecret ?? "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const authorized =
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);

  return authorized
    ? { ok: true }
    : {
        error: "Connector API authentication failed.",
        ok: false,
        status: 401,
      };
}

export function validateConnectorRequestIdentity(
  bodyRequestId: unknown,
  headerRequestId: string | undefined,
) {
  if (
    typeof bodyRequestId !== "string" ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(bodyRequestId.trim())
  ) {
    return { ok: false, error: "requestId is required and must be a stable safe identifier." } as const;
  }

  const requestId = bodyRequestId.trim();
  if (headerRequestId?.trim() && headerRequestId.trim() !== requestId) {
    return {
      ok: false,
      error: "Connector request identity does not match the request body.",
    } as const;
  }

  return { ok: true, requestId } as const;
}

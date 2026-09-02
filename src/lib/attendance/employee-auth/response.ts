import { NextResponse } from "next/server";
import {
  isEmployeeAuthError,
  toEmployeeAuthError,
} from "./errors";

export function employeeAuthJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export function employeeAuthErrorResponse(error: unknown) {
  const normalized = toEmployeeAuthError(error);

  if (!isEmployeeAuthError(error)) {
    console.error("[employee-auth] Request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: readSafeDatabaseErrorCode(error),
    });
  } else if (error.code === "CONFIGURATION_ERROR") {
    console.error("[employee-auth] Configuration unavailable", {
      code: error.code,
    });
  }

  return employeeAuthJson(
    {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.publicMessage,
      },
    },
    { status: normalized.status },
  );
}

function readSafeDatabaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

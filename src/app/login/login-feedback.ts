import type { PasswordLoginResult } from "@/lib/auth/password-login";

type PasswordLoginFailureCode = Extract<PasswordLoginResult, { ok: false }>["code"];

const TEMPORARY_DATABASE_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
  "P2034",
]);

export function messageForPasswordLoginFailure(code: PasswordLoginFailureCode): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Email or password is incorrect. Please try again.";
    case "ACCOUNT_UNAVAILABLE":
      return "This account is currently unavailable. Please contact your administrator.";
    case "SERVICE_LOGIN_DENIED":
      return "This account cannot be used to sign in here.";
    case "RATE_LIMITED":
      return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
}

export function messageForLoginException(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, name, message } = error as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (
      (typeof code === "string" && TEMPORARY_DATABASE_CODES.has(code)) ||
      name === "PrismaClientInitializationError" ||
      message === "SESSION_SECRET must be at least 32 characters."
    ) {
      return "We couldn’t sign you in right now. Please try again in a few minutes.";
    }
  }
  return "Something went wrong while signing you in. Please try again.";
}

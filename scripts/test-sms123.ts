import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { normalizeAttendancePhone } from "../src/lib/attendance/phone";
import { getEmployeeAuthConfig } from "../src/lib/attendance/employee-auth/config";
import {
  EmployeeOtpProviderError,
  Sms123Provider,
} from "../src/lib/attendance/employee-auth/provider";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "SMS test failed.";
  const providerCode =
    error instanceof EmployeeOtpProviderError
      ? error.providerMessageCode
      : null;
  console.error(`[sms123-test] ${message}`);
  if (providerCode) console.error(`[sms123-test] providerMessageCode=${providerCode}`);
  process.exitCode = 1;
});

async function main() {
  const target = readRequiredTarget(process.argv.slice(2));
  const normalized = normalizeAttendancePhone(target);
  if (!normalized || !normalized.startsWith("+60")) {
    throw new Error(
      "--to must be a valid Malaysian mobile number, for example 6011XXXXXXXX.",
    );
  }

  const config = getEmployeeAuthConfig({
    ...process.env,
    EMPLOYEE_AUTH_SECRET:
      process.env.EMPLOYEE_AUTH_SECRET ??
      (process.env.NODE_ENV === "production"
        ? undefined
        : "sms123-manual-local-config-check-secret-v1"),
    SMS_PROVIDER: "sms123",
    OTP_PROVIDER: "sms123",
    OTP_CHANNEL: "sms",
  });
  const provider = new Sms123Provider(config);
  const referenceId = `sms_test_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const result = await provider.sendSms({
    recipient: normalized,
    message: `${config.otp.sms123.messagePrefix} Tetamu: SMS123 connection test. No action is required.`,
    referenceId,
    challengeId: referenceId,
    purpose: "LOGIN",
    expiresAt: new Date(Date.now() + 5 * 60_000),
    locale: config.otp.locale,
  });

  console.log(
    JSON.stringify(
      {
        status: result.status,
        provider: provider.name,
        providerReferenceId: result.providerReferenceId,
        providerMessageCode: result.providerMessageCode,
        recipient: maskPhone(normalized),
      },
      null,
      2,
    ),
  );
}

function readRequiredTarget(args: string[]) {
  const targets = args.filter((argument) => argument.startsWith("--to="));
  if (targets.length !== 1 || args.length !== 1) {
    throw new Error("Usage: npm run sms:test -- --to=6011XXXXXXXX");
  }
  const value = targets[0].slice("--to=".length).trim();
  if (!value) throw new Error("--to is required.");
  return value;
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

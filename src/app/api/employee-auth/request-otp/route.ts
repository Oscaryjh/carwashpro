import { after } from "next/server";
import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import {
  assertEmployeeAuthSameOrigin,
  getEmployeeAuthRequestContext,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import { requestEmployeeOtp } from "@/lib/attendance/employee-auth/otp-service";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import { requestEmployeeOtpSchema } from "@/lib/attendance/employee-auth/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const input = await readEmployeeAuthJson(
      request,
      requestEmployeeOtpSchema,
    );
    const result = await requestEmployeeOtp(
      {
        phoneNumber: input.phoneNumber,
        deviceIdentifier: input.deviceIdentifier,
        request: getEmployeeAuthRequestContext(request),
      },
      {
        dispatchDelivery: (task) => after(task),
        requireAttendance: false,
      },
    );
    const config = getEmployeeAuthConfig();

    return employeeAuthJson(
      {
        ok: true,
        challengeId: result.challengeId,
        message: result.message,
        expiresInSeconds: config.otp.expiresInSeconds,
        resendAfterSeconds: config.otp.resendCooldownSeconds,
      },
      { status: 202 },
    );
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}

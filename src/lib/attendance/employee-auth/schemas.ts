import { z } from "zod";

const deviceIdentifier = z.string().trim().min(16).max(256);
const optionalClientLabel = z.string().trim().min(1).max(100).optional();

export const requestEmployeeOtpSchema = z
  .object({
    phoneNumber: z.string().trim().min(1).max(40),
    deviceIdentifier,
  })
  .strict();

export const verifyEmployeeOtpSchema = z
  .object({
    challengeId: z.string().uuid(),
    otp: z.string().regex(/^\d{6}$/),
    deviceIdentifier,
    displayName: optionalClientLabel,
    platform: optionalClientLabel,
    browser: optionalClientLabel,
  })
  .strict();

export const selectEmployeeMembershipSchema = z
  .object({
    selectionToken: z.string().trim().min(32).max(4_096),
    membershipId: z.string().uuid(),
    deviceIdentifier,
    displayName: optionalClientLabel,
    platform: optionalClientLabel,
    browser: optionalClientLabel,
  })
  .strict();

export type RequestEmployeeOtpInput = z.infer<
  typeof requestEmployeeOtpSchema
>;
export type VerifyEmployeeOtpInput = z.infer<
  typeof verifyEmployeeOtpSchema
>;
export type SelectEmployeeMembershipInput = z.infer<
  typeof selectEmployeeMembershipSchema
>;

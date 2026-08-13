export type MfaErrorCode =
  | "MFA_ALREADY_ENROLLED"
  | "MFA_CREDENTIAL_CHANGED"
  | "MFA_ENCRYPTION_NOT_CONFIGURED"
  | "MFA_ENROLLMENT_EXPIRED"
  | "MFA_ENROLLMENT_SESSION_MISMATCH"
  | "MFA_NOT_ENROLLED"
  | "MFA_PASSWORD_REAUTH_FAILED"
  | "MFA_RATE_LIMITED"
  | "MFA_RECOVERY_NOT_AVAILABLE"
  | "MFA_REPLAYED"
  | "MFA_VERIFICATION_FAILED";

export class MfaError extends Error {
  constructor(public readonly code: MfaErrorCode) {
    super(code);
    this.name = "MfaError";
  }
}

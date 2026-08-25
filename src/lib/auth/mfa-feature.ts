/**
 * Temporary product switch for MFA.
 *
 * MFA remains implemented and its stored credentials/audit records are kept.
 * Set TETAMU_MFA_ENABLED=true to restore enrollment, challenges and step-up UI.
 * Existing automated security tests keep exercising MFA unless they explicitly
 * override this setting.
 */
export function isMfaFeatureEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configured = env.TETAMU_MFA_ENABLED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return env.NODE_ENV === "test" || Boolean(env.NODE_TEST_CONTEXT);
}

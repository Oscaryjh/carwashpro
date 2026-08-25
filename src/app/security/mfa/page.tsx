import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { AppShell } from "@/components/app-shell";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { getMfaSecurityState } from "@/lib/auth/mfa-service";
import { requireUser } from "@/lib/auth/session";
import { MfaClient } from "./mfa-client";

type Props = Readonly<{
  searchParams: Promise<{ result?: string; error?: string }>;
}>;

export default async function MfaSecurityPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!isMfaFeatureEnabled()) redirect("/reports");
  if (!user.sessionId) throw new Error("MFA_VERIFICATION_FAILED");
  const messages = await searchParams;
  const state = await getMfaSecurityState({
    userId: user.userId,
    sessionId: user.sessionId,
  });
  const clientState = state.status === "PENDING" && state.pending
    ? {
        status: "PENDING" as const,
        pending: {
          credentialId: state.pending.credentialId,
          expiresAt: state.pending.expiresAt.toISOString(),
          manualSecret: state.pending.manualSecret,
          qrDataUrl: await QRCode.toDataURL(state.pending.otpauthUri, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 240,
          }),
        },
      }
    : state.status === "ENROLLED"
      ? {
          status: "ENROLLED" as const,
          pending: null,
          enrolledAt: state.enrolledAt?.toISOString() ?? null,
          recoveryCodesAvailable: state.recoveryCodesAvailable,
        }
      : { status: "NOT_ENROLLED" as const, pending: null };

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div>
          <p><Link href={user.role === "PLATFORM_ADMIN" ? "/admin/businesses" : "/team"}>Account security</Link></p>
          <h1>Multi-factor authentication</h1>
          <p>RFC 6238 TOTP for sensitive-action step-up. Login MFA remains out of scope.</p>
        </div></div>
        <div className="panel">
          <strong>LOCAL / TESTING ONLY</strong>
          <p>Password re-authentication alone is not MFA. A current authenticator or recovery factor is always verified for MFA assurance.</p>
        </div>
        {messages.result ? <div className="panel"><strong data-testid="mfa-result">{messages.result}</strong></div> : null}
        {messages.error ? <div className="panel"><strong data-testid="mfa-error">{messages.error}</strong></div> : null}
        <MfaClient state={clientState}/>
      </section>
    </AppShell>
  );
}

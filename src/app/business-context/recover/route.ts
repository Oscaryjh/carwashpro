import {
  commitBusinessContextSwitch,
  getRecoveryBusinessContext,
  safeBusinessReturnTo,
} from "@/lib/business-groups/business-context";
import {
  createSessionToken,
  persistSessionContext,
  requireUser,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { internalRedirect } from "@/lib/http/internal-redirect";

export async function GET() {
  const user = await requireUser();
  const recovery = await getRecoveryBusinessContext(user);
  if (!recovery.ok) {
    return internalRedirect("/no-business-access");
  }

  const destination = safeBusinessReturnTo(null, recovery.context);
  const response = internalRedirect(destination);
  const result = await commitBusinessContextSwitch(
    {
      session: user,
      targetBusinessId: recovery.context.businessId,
      source: "RECOVERY",
    },
    {
      writeSession: async (session, transaction) => {
        const stored = await persistSessionContext(session, {
          database: transaction,
        });
        const token = await createSessionToken(session, {
          absoluteExpiresAt: stored.absoluteExpiresAt,
        });
        const maxAge = Math.max(
          0,
          Math.ceil((stored.absoluteExpiresAt.getTime() - Date.now()) / 1_000),
        );
        response.cookies.set(
          SESSION_COOKIE,
          token,
          sessionCookieOptions(maxAge),
        );
      },
    },
  );
  if (!result.ok) {
    return internalRedirect("/no-business-access");
  }

  return response;
}

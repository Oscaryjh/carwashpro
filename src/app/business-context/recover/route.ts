import { NextResponse, type NextRequest } from "next/server";
import {
  commitBusinessContextSwitch,
  getRecoveryBusinessContext,
  safeBusinessReturnTo,
} from "@/lib/business-groups/business-context";
import {
  createSessionToken,
  requireUser,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const recovery = await getRecoveryBusinessContext(user);
  if (!recovery.ok) {
    return NextResponse.redirect(new URL("/no-business-access", request.url));
  }

  const destination = safeBusinessReturnTo(null, recovery.context);
  const response = NextResponse.redirect(new URL(destination, request.url));
  const result = await commitBusinessContextSwitch(
    {
      session: user,
      targetBusinessId: recovery.context.businessId,
      source: "RECOVERY",
    },
    {
      writeSession: async (session) => {
        const token = await createSessionToken(session);
        response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      },
    },
  );
  if (!result.ok) {
    return NextResponse.redirect(new URL("/no-business-access", request.url));
  }

  return response;
}

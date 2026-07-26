import { jwtVerify, SignJWT } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { getStaffHomePath, routePermission } from "@/lib/auth/staff-permissions";

const SESSION_COOKIE = "car_wash_session";
const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 7;

function getSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return null;
  }

  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const secret = getSecret();
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!secret || !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const verified = await jwtVerify(token, secret);
    const legacyBusinessId =
      typeof verified.payload.businessId === "string"
        ? verified.payload.businessId
        : null;
    const homeBusinessId =
      typeof verified.payload.homeBusinessId === "string"
        ? verified.payload.homeBusinessId
        : legacyBusinessId;
    const activeBusinessId =
      typeof verified.payload.activeBusinessId === "string"
        ? verified.payload.activeBusinessId
        : legacyBusinessId;
    verified.payload.homeBusinessId = homeBusinessId;
    verified.payload.activeBusinessId = activeBusinessId;
    verified.payload.businessId = activeBusinessId;
    verified.payload.contextVersion =
      typeof verified.payload.contextVersion === "number" &&
      Number.isSafeInteger(verified.payload.contextVersion) &&
      verified.payload.contextVersion > 0
        ? verified.payload.contextVersion
        : 1;
    const role = verified.payload.role;
    const pathname = request.nextUrl.pathname;
    const industryType =
      typeof verified.payload.industryType === "string"
        ? verified.payload.industryType
        : null;
    const permissions = Array.isArray(verified.payload.permissions)
      ? verified.payload.permissions
      : [];
    const staffHomePath = getStaffHomePath(permissions, industryType);

    if (pathname.startsWith("/admin") && role !== "PLATFORM_ADMIN") {
      return NextResponse.redirect(
        new URL(role === "STAFF" ? staffHomePath : "/reports", request.url),
      );
    }

    if (!pathname.startsWith("/admin") && role === "PLATFORM_ADMIN") {
      return NextResponse.redirect(new URL("/admin/businesses", request.url));
    }

    if (pathname === "/dashboard" || pathname === "/salon/dashboard") {
      return NextResponse.redirect(new URL("/reports", request.url));
    }

    if (industryType === "SALON_BEAUTY" && pathname.startsWith("/work-orders")) {
      return NextResponse.redirect(
        new URL(permissions.includes("POS") || role === "BUSINESS_OWNER" ? "/cashier" : staffHomePath, request.url),
      );
    }

    if (industryType === "AUTO_DETAILING" && pathname.startsWith("/cashier")) {
      return NextResponse.redirect(
        new URL(permissions.includes("JOBS") || role === "BUSINESS_OWNER" ? "/work-orders" : staffHomePath, request.url),
      );
    }

    const requiredPermission = routePermission(pathname);

    if (requiredPermission === "OWNER_ONLY" && role !== "BUSINESS_OWNER") {
      return NextResponse.redirect(new URL(staffHomePath, request.url));
    }

    if (requiredPermission && requiredPermission !== "OWNER_ONLY" && role === "STAFF") {
      if (!permissions.includes(requiredPermission)) {
        return NextResponse.redirect(new URL(staffHomePath, request.url));
      }
    }
    const response = NextResponse.next();
    await refreshSessionCookie(response, verified.payload, secret);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

async function refreshSessionCookie(
  response: NextResponse,
  payload: Record<string, unknown>,
  secret: Uint8Array,
) {
  const session = { ...payload };
  delete session.exp;
  delete session.iat;
  delete session.nbf;
  delete session.jti;

  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_IDLE_SECONDS}s`)
    .sign(secret);

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_IDLE_SECONDS,
  });
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/appointments/:path*",
    "/branches/:path*",
    "/business/settings",
    "/cashier/:path*",
    "/closing/:path*",
    "/crm/:path*",
    "/dashboard/:path*",
    "/invoices/:path*",
    "/loyalty/:path*",
    "/packages/:path*",
    "/pos/:path*",
    "/products/:path*",
    "/reports/:path*",
    "/salon/dashboard",
    "/services/:path*",
    "/team/:path*",
    "/whatsapp/:path*",
    "/work-orders/:path*",
  ],
};

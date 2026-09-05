import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { getStaffHomePath, routePermission } from "@/lib/auth/staff-permissions";

const SESSION_COOKIE = "car_wash_session";

function getSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return null;
  }

  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Gate only the new Staff route before layout streaming (which otherwise converts notFound to HTTP 200).
  // Staff authentication remains in the page/API, never the back-office cookie path below.
  if (pathname === "/staff/performance") {
    return process.env.TETAMU_STAFF_PERFORMANCE === "true" ? NextResponse.next() :
      new NextResponse("Performance is not enabled.", { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  // The dedicated Staff App deployment shares the codebase but not the
  // back-office surface. Keep staff APIs available while redirecting any
  // accidentally opened back-office page to the Staff App login.
  if (
    process.env.TETAMU_APP_SURFACE === "staff" &&
    !pathname.startsWith("/staff")
  ) {
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  // The back-office login page must remain reachable without a session. It is
  // included in the matcher so the dedicated Staff surface can redirect it to
  // /staff/login above, but the POS surface must not redirect /login to itself.
  if (pathname === "/login") {
    return NextResponse.next();
  }

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
    const homeBusinessId = Object.prototype.hasOwnProperty.call(
      verified.payload,
      "homeBusinessId",
    )
      ? nullableString(verified.payload.homeBusinessId)
      : legacyBusinessId;
    const activeBusinessId = Object.prototype.hasOwnProperty.call(
      verified.payload,
      "activeBusinessId",
    )
      ? nullableString(verified.payload.activeBusinessId)
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
    if (
      typeof verified.payload.sessionId !== "string" ||
      verified.payload.sessionId.length === 0
    ) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const industryType =
      typeof verified.payload.industryType === "string"
        ? verified.payload.industryType
        : null;
    const permissions = Array.isArray(verified.payload.permissions)
      ? verified.payload.permissions
      : [];
    const isDelegatedBusinessContext =
      Boolean(activeBusinessId) &&
      activeBusinessId !== homeBusinessId;
    const staffHomePath = getStaffHomePath(permissions, industryType);

    if (pathname.startsWith("/admin") && role !== "PLATFORM_ADMIN") {
      return NextResponse.redirect(
        new URL(role === "STAFF" ? staffHomePath : "/reports", request.url),
      );
    }

    if (!pathname.startsWith("/admin") && role === "PLATFORM_ADMIN") {
      return NextResponse.redirect(new URL("/admin/businesses", request.url));
    }

    if (pathname === "/business-context/recover") {
      return NextResponse.next();
    }

    if (pathname === "/salon/dashboard") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
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

    if (
      !isDelegatedBusinessContext &&
      requiredPermission === "OWNER_ONLY" &&
      role !== "BUSINESS_OWNER"
    ) {
      return NextResponse.redirect(new URL(staffHomePath, request.url));
    }

    if (
      !isDelegatedBusinessContext &&
      requiredPermission &&
      requiredPermission !== "OWNER_ONLY" &&
      role === "STAFF"
    ) {
      if (!permissions.includes(requiredPermission)) {
        return NextResponse.redirect(new URL(staffHomePath, request.url));
      }
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const config = {
  matcher: [
    "/staff/performance",
    "/",
    "/admin/:path*",
    "/appointments/:path*",
    "/ai/:path*",
    "/branches/:path*",
    "/business/settings/:path*",
    "/business-context/:path*",
    "/cashier/:path*",
    "/closing/:path*",
    "/crm/:path*",
    "/dashboard/:path*",
    "/groups/:path*",
    "/invoices/:path*",
    "/login",
    "/logout",
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

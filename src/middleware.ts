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
  const secret = getSecret();
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!secret || !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const verified = await jwtVerify(token, secret);
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
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
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

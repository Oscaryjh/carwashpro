import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { routePermission } from "@/lib/auth/staff-permissions";

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

    if (pathname.startsWith("/admin") && role !== "PLATFORM_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (!pathname.startsWith("/admin") && role === "PLATFORM_ADMIN") {
      return NextResponse.redirect(new URL("/admin/businesses", request.url));
    }

    const requiredPermission = routePermission(pathname);

    if (requiredPermission === "OWNER_ONLY" && role !== "BUSINESS_OWNER") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (requiredPermission && requiredPermission !== "OWNER_ONLY" && role === "STAFF") {
      const permissions = Array.isArray(verified.payload.permissions)
        ? verified.payload.permissions
        : [];

      if (!permissions.includes(requiredPermission)) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
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
    "/branches/:path*",
    "/business/settings",
    "/closing/:path*",
    "/crm/:path*",
    "/dashboard/:path*",
    "/invoices/:path*",
    "/packages/:path*",
    "/pos/:path*",
    "/reports/:path*",
    "/services/:path*",
    "/team/:path*",
    "/whatsapp/:path*",
    "/work-orders/:path*",
  ],
};

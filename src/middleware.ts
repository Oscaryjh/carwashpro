import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { getStaffHomePath, routePermission } from "@/lib/auth/staff-permissions";
import {
  classifyPosPilotRoute,
  evaluatePosPilotWriteRequest,
  FROZEN_DOMAIN_DENIED,
  maintenanceAuditEvent,
  POS_PILOT_SMOKE_COOKIE,
  posPilotSmokeScopeMatches,
  resolvePosPilotSmokeConfig,
  resolvePosPilotWriteFreezeMode,
  verifyPosPilotSmokeCapability,
  writeFrozenResponse,
} from "@/lib/release/pos-pilot-contract";

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

  if (classifyPosPilotRoute(pathname, request.nextUrl.searchParams) === "FROZEN") {
    return new NextResponse(FROZEN_DOMAIN_DENIED, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const writeFreeze = await enforceWriteFreeze(request);
  if (writeFreeze) return writeFreeze;

  // API routes own their authentication boundary. Including them in the
  // matcher is required so the write freeze runs before route parsing, while
  // this return preserves existing employee/webhook/auth semantics.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
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

async function enforceWriteFreeze(request: NextRequest) {
  let mode: ReturnType<typeof resolvePosPilotWriteFreezeMode>;
  try {
    mode = resolvePosPilotWriteFreezeMode();
  } catch {
    logMaintenanceEvent(maintenanceAuditEvent({
      event: "SMOKE_DENIED",
      mode: "full",
      reason: "INVALID_CONFIGURATION",
    }));
    return writeFrozenResponse();
  }

  const initial = evaluatePosPilotWriteRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    mode,
  });
  if (initial === "ALLOW") return null;
  if (initial === "DENY") {
    logMaintenanceEvent(maintenanceAuditEvent({
      event: "SMOKE_DENIED",
      mode,
      reason: mode === "full" ? "FULL_FREEZE" : "OPERATION_NOT_ALLOWLISTED",
    }));
    return writeFrozenResponse();
  }

  const authorizedScope = await verifiedSmokeScope(request);
  if (!authorizedScope) {
    logMaintenanceEvent(maintenanceAuditEvent({
      event: "SMOKE_DENIED",
      mode,
      reason: "CAPABILITY_OR_SCOPE_INVALID",
    }));
    return writeFrozenResponse();
  }

  const finalDecision = evaluatePosPilotWriteRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    mode,
    smokeCapabilityValid: true,
  });
  if (finalDecision !== "ALLOW") return writeFrozenResponse();
  logMaintenanceEvent(maintenanceAuditEvent({
    event: "SMOKE_ACCEPTED",
    mode,
    ...authorizedScope,
    operation: request.nextUrl.pathname,
  }));
  return null;
}

async function verifiedSmokeScope(request: NextRequest) {
  try {
    const config = resolvePosPilotSmokeConfig();
    const capability = await verifyPosPilotSmokeCapability({
      token: request.cookies.get(POS_PILOT_SMOKE_COOKIE)?.value ?? "",
      secret: config.secret,
    });
    if (!capability || !posPilotSmokeScopeMatches(capability, config)) return null;

    const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
    const sessionSecret = getSecret();
    if (!sessionToken || !sessionSecret) return null;
    const verified = await jwtVerify(sessionToken, sessionSecret);
    const sessionScope = {
      actorId: typeof verified.payload.userId === "string" ? verified.payload.userId : "",
      businessId: typeof verified.payload.activeBusinessId === "string"
        ? verified.payload.activeBusinessId
        : "",
      branchId: typeof verified.payload.branchId === "string" ? verified.payload.branchId : "",
    };
    if (verified.payload.role !== "BUSINESS_OWNER") return null;
    return posPilotSmokeScopeMatches(capability, sessionScope) ? capability : null;
  } catch {
    return null;
  }
}

function logMaintenanceEvent(event: Record<string, unknown>) {
  console.info(JSON.stringify(event));
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/api/:path*",
    "/appointments/:path*",
    "/ai/:path*",
    "/branches/:path*",
    "/business/:path*",
    "/business/settings/:path*",
    "/business-context/:path*",
    "/cashier/:path*",
    "/catalog/:path*",
    "/closing/:path*",
    "/crm/:path*",
    "/dashboard/:path*",
    "/discounts/:path*",
    "/expenses/:path*",
    "/groups/:path*",
    "/inventory/:path*",
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
    "/staff/:path*",
    "/team/:path*",
    "/whatsapp/:path*",
    "/work-orders/:path*",
  ],
};

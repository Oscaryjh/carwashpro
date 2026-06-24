import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

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

    if (verified.payload.role !== "PLATFORM_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

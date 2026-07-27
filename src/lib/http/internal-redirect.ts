import { NextResponse } from "next/server";

export function internalRedirect(pathname: string, status = 307) {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("Internal redirects require a site-relative path.");
  }

  return new NextResponse(null, {
    status,
    headers: { location: pathname },
  });
}

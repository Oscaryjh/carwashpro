import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { destroySession } from "@/lib/auth/session";

export async function POST() {
  await destroySession();
  redirect("/login");
}

export async function GET(request: NextRequest) {
  await destroySession();

  const error = request.nextUrl.searchParams.get("error");
  const target = error ? `/login?error=${encodeURIComponent(error)}` : "/login";

  redirect(target);
}

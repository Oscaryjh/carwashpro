import { isEmployeeAvatarFilename, readRuntimeEmployeeAvatar } from "@/lib/runtime-employee-avatar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EmployeeAvatarRouteProps = {
  params: Promise<{ filename: string }>;
};

export async function GET(
  _request: Request,
  { params }: EmployeeAvatarRouteProps,
) {
  const { filename } = await params;
  if (!isEmployeeAvatarFilename(filename)) return unavailable(404);
  let bytes: Buffer | null;
  try {
    bytes = await readRuntimeEmployeeAvatar(filename);
  } catch (error) {
    console.error("[employee-avatar] Private avatar read unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return unavailable(503);
  }

  if (!bytes) {
    return unavailable(404);
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function unavailable(status: 404 | 503) {
  return new Response(status === 404 ? "Avatar not found." : "Avatar temporarily unavailable.", {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

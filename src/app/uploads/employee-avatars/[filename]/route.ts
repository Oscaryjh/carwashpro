import { readRuntimeEmployeeAvatar } from "@/lib/runtime-employee-avatar";

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
  const bytes = await readRuntimeEmployeeAvatar(filename, undefined, _request.headers.get("x-tetamu-image-fallback") !== "1");

  if (!bytes) {
    return new Response("Avatar not found.", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
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

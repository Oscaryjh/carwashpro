import { readRuntimeBusinessLogo } from "@/lib/runtime-business-logo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BusinessLogoRouteProps = {
  params: Promise<{ filename: string }>;
};

export async function GET(
  _request: Request,
  { params }: BusinessLogoRouteProps,
) {
  const { filename } = await params;
  const logo = await readRuntimeBusinessLogo(filename);

  if (!logo) {
    return new Response("Logo not found.", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(logo.bytes.byteLength),
      "Content-Type": logo.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.APP_BUILD_SHA ?? "";
  return Response.json({ version: /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null }, {
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

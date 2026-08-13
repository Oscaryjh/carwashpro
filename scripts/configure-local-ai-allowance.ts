import { prisma } from "../src/lib/prisma";
import { createAiAllowancePolicy } from "../src/lib/ai/commercial";

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_PRODUCTION_AI_ALLOWANCE === "true") {
    throw new Error("This command is Local / Testing only.");
  }
  const [scopeType, scopeId, requestLimitValue, timezone, ...reasonParts] = process.argv.slice(2);
  if (!new Set(["BUSINESS", "GROUP"]).has(scopeType) || !scopeId || !/^\d+$/.test(requestLimitValue ?? "")) {
    throw new Error("Usage: tsx scripts/configure-local-ai-allowance.ts BUSINESS|GROUP <scope-id> <request-limit> <timezone-or-dash> <reason>");
  }
  const reason = reasonParts.join(" ").trim();
  if (!reason) throw new Error("A reason is required.");
  const actor = await prisma.user.findFirst({ where: { role: "PLATFORM_ADMIN", status: "active" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error("No active Local / Testing PLATFORM_ADMIN exists.");
  const policy = await createAiAllowancePolicy({
    actorUserId: actor.id,
    scopeType: scopeType as "BUSINESS" | "GROUP",
    businessId: scopeType === "BUSINESS" ? scopeId : null,
    groupId: scopeType === "GROUP" ? scopeId : null,
    effectiveFrom: new Date(),
    requestLimit: Number(requestLimitValue),
    tokenLimit: null,
    timezone: timezone && timezone !== "-" ? timezone : undefined,
    source: "PLATFORM_OVERRIDE",
    reason: `LOCAL / TESTING ONLY: ${reason}`,
  });
  process.stdout.write(`Created Local / Testing AI allowance revision ${policy.revision} for ${policy.scopeKey}.\n`);
}

main().finally(() => prisma.$disconnect());

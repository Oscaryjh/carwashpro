import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { askTetamuAi, AiServiceError } from "../src/lib/ai/service";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Local / Testing only.");
  process.env.AI_PROVIDER = "mock";
  process.env.AI_MOCK_COMMERCIAL_COUNTED = "true";
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "ai.business.owner@local.test" }, include: { business: true } });
  if (!user.businessId || !user.business) throw new Error("Local AI QA user is not business-bound.");
  let providerCalls = 0;
  const session = { userId: user.id, homeBusinessId: user.businessId, activeBusinessId: user.businessId, contextVersion: 1, businessId: user.businessId, branchId: user.branchId, name: user.name, email: user.email!, role: user.role, permissions: user.permissions, status: user.status };
  const access = { granted: true as const, userId: user.id, homeBusinessId: user.businessId, businessId: user.businessId, branchId: user.branchId, identityRole: user.role, actorRole: user.role, effectiveBusinessRole: "BUSINESS_OWNER" as const, source: "DIRECT_BUSINESS" as const, industryType: user.business.industryType, permissions: user.permissions, groupId: null, groupUserId: null, capability: "USE_AI_ANALYSIS" as const };
  let blockedCode = "";
  try {
    await askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: user.businessId, access, user: session }, question: "This third request must be blocked before provider execution.", clientRequestId: randomUUID() }, { provider: { analyze: async () => { providerCalls += 1; throw new Error("PROVIDER_MUST_NOT_BE_CALLED"); } } });
  } catch (error) {
    if (error instanceof AiServiceError) blockedCode = error.code;
    else throw error;
  }
  process.stdout.write(`${JSON.stringify({ blockedCode, providerCalls })}\n`);
  if (blockedCode !== "AI_QUOTA_EXCEEDED" || providerCalls !== 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main();

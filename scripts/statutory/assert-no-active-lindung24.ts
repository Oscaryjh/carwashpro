import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma";

async function main() {
  try {
    const activeRules = await prisma.statutoryRuleSet.findMany({
      where: { scheme: "LINDUNG24", status: "ACTIVE" },
      select: { id: true, version: true },
    });
    assert.deepEqual(activeRules, [], "ACTIVE LINDUNG24 rules must remain empty before human sign-off.");
    console.log("ACTIVE_LINDUNG24_RULES=[]");
  } finally {
    await prisma.$disconnect();
  }
}

void main();

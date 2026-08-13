import { prisma } from "../src/lib/prisma";

if (process.env.NODE_ENV === "production") throw new Error("LOCAL_TESTING_ONLY");

async function main() {
const customers = await Promise.all(["A", "B"].map(async suffix => {
  const slug = `commercial-browser-${suffix.toLowerCase()}`;
  const business = await prisma.business.upsert({
    where: { slug },
    update: { name: `Commercial Browser Customer ${suffix}`, status: "active" },
    create: { slug, name: `Commercial Browser Customer ${suffix}`, status: "active" },
  });
  const branch = await prisma.branch.findFirst({ where: { businessId: business.id } }) ?? await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const subscriptions = await prisma.commercialSubscription.findMany({ where: { businessId: business.id }, include: { items: { include: { planVersion: { include: { plan: true } } } } } });
  return { id: business.id, name: business.name, branchId: branch.id, subscriptions: subscriptions.map(subscription => ({ id: subscription.id, status: subscription.status, items: subscription.items.map(item => item.planVersion.plan.displayName) })) };
}));

console.log(JSON.stringify({ environment: "LOCAL_TESTING_ONLY", customers }));
await prisma.$disconnect();
}

main().catch(async error => { console.error(error instanceof Error ? error.message : error); await prisma.$disconnect(); process.exitCode = 1; });

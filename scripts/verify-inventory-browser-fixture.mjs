import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
  throw new Error("Inventory browser verification is restricted to the Local database.");
}

const runId = process.env.INVENTORY_QA_RUN_ID;
if (!runId) throw new Error("INVENTORY_QA_RUN_ID is required.");
process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();

async function readProfile(kind) {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: `inventory-qa-${kind}-${runId}` },
  });
  const product = await prisma.product.findFirstOrThrow({
    where: { businessId: business.id, sku: { endsWith: runId } },
  });
  const stocks = await prisma.productStock.findMany({
    where: { businessId: business.id, productId: product.id },
    include: { branch: { select: { name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
  const movements = await prisma.inventoryMovement.findMany({
    where: { businessId: business.id, productId: product.id },
    orderBy: { createdAt: "asc" },
  });
  const ledgerTotal = movements.reduce((sum, movement) => sum + movement.quantityDelta, 0);
  const balanceTotal = stocks.reduce((sum, stock) => sum + stock.quantity, 0);
  return { business, product, stocks, movements, ledgerTotal, balanceTotal };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const salon = await readProfile("salon");
  const auto = await readProfile("auto");
  const salonMain = salon.stocks.find((stock) => stock.branch.name === "Main Branch");
  const autoMain = auto.stocks.find((stock) => stock.branch.name === "Main Branch");
  const autoOutlet = auto.stocks.find((stock) => stock.branch.name === "Outlet Branch");

  assert(salon.product.trackInventory, "Salon product is not tracked.");
  assert(salonMain?.quantity === 9, "Salon expected Main Branch balance 9.");
  assert(salon.ledgerTotal === salon.balanceTotal, "Salon ledger does not reconcile.");
  assert(salon.movements.filter((movement) => movement.type === "SALE").length === 1, "Salon sale movement must be unique.");
  assert(salon.movements.some((movement) => movement.type === "REFUND_RESTOCK" && movement.quantityDelta === 1), "Salon restock refund is missing.");

  const salonRefundLine = await prisma.inventoryRefundLine.findFirst({
    where: { businessId: salon.business.id, productId: salon.product.id, disposition: "RESTOCK", quantity: 1 },
  });
  assert(Boolean(salonRefundLine), "Salon refund disposition audit is missing.");

  assert(auto.product.trackInventory, "Auto product is not tracked.");
  assert(autoMain?.quantity === 5 && autoOutlet?.quantity === 1, "Auto expected balances Main=5 and Outlet=1.");
  assert(auto.ledgerTotal === auto.balanceTotal, "Auto ledger does not reconcile.");
  assert(auto.movements.filter((movement) => movement.type === "SALE").length === 1, "Auto sale movement must be unique.");
  const transferOut = auto.movements.find((movement) => movement.type === "TRANSFER_OUT");
  const transferIn = auto.movements.find((movement) => movement.type === "TRANSFER_IN");
  assert(Boolean(transferOut?.transferId && transferOut.transferId === transferIn?.transferId), "Auto transfer pair is not linked atomically.");
  assert(auto.movements.some((movement) => movement.type === "ADJUSTMENT_IN" && movement.quantityDelta === 2), "Auto adjustment is missing.");

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    status: "PASS",
    salon: {
      balances: salon.stocks.map((stock) => ({ branch: stock.branch.name, quantity: stock.quantity })),
      movements: salon.movements.map((movement) => ({ type: movement.type, delta: movement.quantityDelta })),
      reconciled: salon.ledgerTotal === salon.balanceTotal,
    },
    auto: {
      balances: auto.stocks.map((stock) => ({ branch: stock.branch.name, quantity: stock.quantity })),
      movements: auto.movements.map((movement) => ({ type: movement.type, delta: movement.quantityDelta })),
      reconciled: auto.ledgerTotal === auto.balanceTotal,
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

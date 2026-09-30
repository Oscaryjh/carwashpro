import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { createSessionToken, persistSessionContext } from "../../src/lib/auth/session";
import { walletFixture } from "./wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import type { PrismaClient } from "@prisma/client";
import type * as Actions from "../../src/app/(business)/cashier/actions";

export async function checkoutHarness(database?: PrismaClient) {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-checkout-"));
  const state = globalThis as typeof globalThis & { walletCheckoutCookie?: string; walletCheckoutDb?: PrismaClient };
  let failure: { model: string; method: string } | null = null;
  let injected = 0;
  let beforeTransaction: (() => Promise<void>) | null = null;
  if (database) state.walletCheckoutDb = new Proxy(database, { get(target, key) {
    if (key === "$transaction") return async (callback: (tx: unknown) => unknown, options: unknown) => {
      const hook = beforeTransaction; beforeTransaction = null; await hook?.();
      return database.$transaction(async tx => callback(new Proxy(tx, { get(client, model) {
      const value = Reflect.get(client, model);
      if (!failure || model !== failure.model) return value;
      return new Proxy(value, { get(delegate, method) {
        const original = Reflect.get(delegate, method);
        if (method !== failure?.method) return original;
        return async (...args: unknown[]) => { await original.apply(delegate, args); injected++; throw new Error(`P1C_INJECTED_${String(model)}`); };
      } });
    } })), options as never);
    };
    return Reflect.get(target, key);
  } });
  await build({ entryPoints: { cashier: "src/app/(business)/cashier/actions.ts", pos: "src/app/(business)/pos/actions.ts", appointments: "src/app/(business)/appointments/actions.ts", invoices: "src/app/(business)/invoices/actions.ts", products: "src/app/(business)/products/actions.ts", workOrders: "src/app/(business)/work-orders/actions.ts" }, outdir: directory, outExtension: { ".js": ".cjs" }, bundle: true, packages: "external", platform: "node", format: "cjs", plugins: [{ name: "local-request", setup(builder) {
    if (database) {
      builder.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: "database", namespace: "request" }));
    }
    builder.onResolve({ filter: /^next\/(headers|cache)$/ }, args => ({ path: args.path, namespace: "request" }));
    builder.onLoad({ filter: /.*/, namespace: "request" }, args => ({ contents: args.path.endsWith("headers")
      ? `export async function cookies(){return {get(){return globalThis.walletCheckoutCookie ? {value:globalThis.walletCheckoutCookie}:undefined}}} export async function headers(){return new Headers()}`
      : args.path === "database" ? `export const prisma=globalThis.walletCheckoutDb;`
      : args.path === "delivery" ? `export async function sendInvoiceIfConnected(){}` : `export function revalidatePath(){}` }));
    // Only delivery is replaced; all auth, transaction, inventory and financial calls remain real.
    builder.onResolve({ filter: /whatsapp\/invoice-notifications$/ }, () => ({ path: "delivery", namespace: "request" }));
  } }] });
  const load = createRequire(import.meta.url);
  const action = load(join(directory, "cashier.cjs")) as typeof Actions;
  return { action, beforeTransaction(hook: () => Promise<void>) { beforeTransaction = hook; }, failAfter(model: string, method: string) { failure = { model, method }; }, injections: () => injected,
    pos: load(join(directory, "pos.cjs")) as typeof import("../../src/app/(business)/pos/actions"),
    appointments: load(join(directory, "appointments.cjs")) as typeof import("../../src/app/(business)/appointments/actions"),
    invoices: load(join(directory, "invoices.cjs")) as typeof import("../../src/app/(business)/invoices/actions"),
    products: load(join(directory, "products.cjs")) as typeof import("../../src/app/(business)/products/actions"),
    workOrders: load(join(directory, "workOrders.cjs")) as typeof import("../../src/app/(business)/work-orders/actions"),
    async login(db: PrismaClient, f: Awaited<ReturnType<typeof walletFixture>>) {
    process.env.SESSION_SECRET = "wallet-p1c-local-disposable-session-secret-0123456789";
    const actor = await db.user.update({ where: { id: f.actor.id }, data: { email: `${randomUUID()}@example.test` } });
    const session = { userId: actor.id, sessionId: randomUUID(), homeBusinessId: f.business.id, activeBusinessId: f.business.id, contextVersion: 1,
      branchId: f.branch.id, name: actor.name, email: actor.email!, role: actor.role, permissions: actor.permissions, status: actor.status };
    const stored = await persistSessionContext(session, { database: db });
    state.walletCheckoutCookie = await createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
  }, async close() { delete state.walletCheckoutCookie; delete state.walletCheckoutDb; await rm(directory, { recursive: true, force: true }); } };
}

export async function checkoutFixture(db: PrismaClient, method = "MEMBER_WALLET") {
  const f = await walletFixture(db, "50", "30");
  await postWalletTopUp(f.ctx, f.input, db);
  const product = await db.product.create({ data: { businessId: f.business.id, name: "P1C Synthetic product", sku: randomUUID(), price: 40 } });
  const form = new FormData();
  for (const [key, value] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id,
    method, paymentMethodCode: method === "MEMBER_WALLET" ? method : `BUILTIN_${method}`, walletAmount: method === "MEMBER_WALLET" ? "40" : "20",
    productId: product.id, productQuantity: "1", ...(method !== "MEMBER_WALLET" && method !== "CASH" ? { reference: "synthetic external collection" } : {}) })) form.set(key, value);
  return { ...f, product, form };
}

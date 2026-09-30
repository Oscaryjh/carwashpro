import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { createSessionToken, persistSessionContext } from "../../src/lib/auth/session";
import type * as Actions from "../../src/app/(business)/crm/wallet/actions";

const db = walletTestDatabase();
const require = createRequire(import.meta.url);
let directory: string;
const oldSecret = process.env.SESSION_SECRET;
const state = globalThis as typeof globalThis & { walletActionCookie?: string };
after(async () => { process.env.SESSION_SECRET = oldSecret; delete state.walletActionCookie; await db.$disconnect(); if (directory) await rm(directory, { recursive: true, force: true }); });
const form = (values: Record<string, unknown>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, String(value)); return data; };

test("real signed database-backed sessions exercise all wallet server actions and tenant denials", async () => {
  process.env.SESSION_SECRET = "wallet-p1b5-disposable-auth-test-secret-0123456789";
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-actions-"));
  await build({ entryPoints: ["src/app/(business)/crm/wallet/actions.ts"], outfile: join(directory, "actions.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs", plugins: [{ name: "request-cookie", setup(builder) {
    // Only Next request plumbing is supplied by the harness. JWT verification,
    // session revocation, current permissions, adapters and all writes remain real.
    builder.onResolve({ filter: /^next\/headers$/ }, () => ({ path: "headers", namespace: "request" }));
    builder.onLoad({ filter: /.*/, namespace: "request" }, () => ({ contents: `export async function cookies(){return {get(){return globalThis.walletActionCookie ? {value:globalThis.walletActionCookie}:undefined}}} export async function headers(){return new Headers()}` }));
  } }] });
  const actions = require(join(directory, "actions.cjs")) as typeof Actions;
  const f = await walletFixture(db); const foreign = await walletFixture(db);
  await db.user.update({ where: { id: f.actor.id }, data: { email: `${randomUUID()}@example.test` } });
  const actor = await db.user.findUniqueOrThrow({ where: { id: f.actor.id } });
  const session = { userId: actor.id, sessionId: randomUUID(), homeBusinessId: f.business.id, activeBusinessId: f.business.id, contextVersion: 1, branchId: f.branch.id, name: actor.name, email: actor.email!, role: actor.role, permissions: [], status: actor.status };
  const stored = await persistSessionContext(session, { database: db });
  state.walletActionCookie = await createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
  const panel = await actions.walletPanelAction(f.customer.id);
  assert.equal(panel.ok, true); if (!panel.ok) return;
  assert.equal(panel.data.totalBalance, "0.00");
  assert.equal(await db.walletAccount.count({ where: { businessId: f.business.id } }), 0);
  assert.equal((await actions.walletPanelAction(foreign.customer.id)).ok, false);
  const values = { businessId: f.business.id, name: "Signed offer", paidAmount: "1000", bonusAmount: "100", active: true };
  const created = await actions.saveWalletOfferAction(form(values));
  assert.equal(created.ok, true); if (!created.ok) return;
  const edited = await actions.saveWalletOfferAction(form({ ...values, id: created.data.id, version: 0, active: false }));
  assert.equal(edited.ok, true);
  const stale = await actions.saveWalletOfferAction(form({ ...values, id: created.data.id, version: 0 }));
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.code, "OFFER_CHANGED_RECONFIRM");
  assert.equal((await actions.saveWalletOfferAction(form({ ...values, id: created.data.id, version: 1 }))).ok, true);
  const [first, duplicate] = await Promise.all([actions.walletTopUpAction(form(f.input)), actions.walletTopUpAction(form(f.input))]);
  assert.equal(first.ok, true); assert.equal(duplicate.ok, true);
  assert.equal(await db.walletTopUp.count({ where: { businessId: f.business.id } }), 1);
  assert.equal((await actions.walletHistoryAction(f.customer.id, 0)).ok, true);
  await db.user.update({ where: { id: actor.id }, data: { role: "STAFF", permissions: ["CRM", "POS"] } });
  assert.equal((await actions.walletHistoryAction(f.customer.id, 0)).ok, false);
  assert.equal((await actions.walletOffersAction()).ok, false);
  assert.equal((await actions.saveWalletOfferAction(form(values))).ok, false);
  const staffPanel = await actions.walletPanelAction(f.customer.id);
  assert.equal(staffPanel.ok, true); if (staffPanel.ok) assert.equal(staffPanel.data.ownerDetails, null);
  const staffReceipt = await actions.walletTopUpAction(form({ ...f.input, operationKey: randomUUID() }));
  assert.equal(staffReceipt.ok, true);
  if (staffReceipt.ok) {
    assert.equal("paidBalance" in staffReceipt.data, false);
    assert.equal("bonusBalance" in staffReceipt.data, false);
  }
  await db.user.update({ where: { id: actor.id }, data: { permissions: ["CRM"] } });
  assert.equal((await actions.walletTopUpAction(form({ ...f.input, operationKey: randomUUID() }))).ok, false);
  assert.equal((await actions.walletTopUpOptionsAction(f.customer.id)).ok, false);
  await db.authSession.update({ where: { id: session.sessionId }, data: { revokedAt: new Date() } });
  await assert.rejects(actions.walletPanelAction(f.customer.id), /NEXT_REDIRECT/);
});

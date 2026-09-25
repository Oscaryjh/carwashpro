import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSessionToken, persistSessionContext, SESSION_COOKIE } from "../../src/lib/auth/session";

const database = new PrismaClient();
const secret = "picker-api-permission-test-secret-0123456789";

test("picker APIs enforce feature capability and business scope with real signed sessions", { timeout: 180_000 }, async () => {
  assert.match(process.env.DATABASE_URL ?? "", /_disposable_/, "run only on a disposable database");
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  const suffix = randomUUID().slice(0, 8);
  const a = await database.business.create({ data: { name: `Picker A ${suffix}`, slug: `picker-a-${suffix}`, industryType: "SALON_BEAUTY" } });
  const b = await database.business.create({ data: { name: `Picker B ${suffix}`, slug: `picker-b-${suffix}`, industryType: "SALON_BEAUTY" } });
  const a1 = await database.branch.create({ data: { businessId: a.id, name: "A1" } });
  const b1 = await database.branch.create({ data: { businessId: b.id, name: "B1" } });
  for (const business of [a, b]) {
    for (const moduleKey of ["POS", "SALON"] as const) {
      await database.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey, status: "ENABLED", enabledFrom: new Date("2026-01-01"), source: "MANUAL" } });
    }
  }
  const existing = await database.customer.create({ data: { businessId: b.id, branchId: b1.id, name: `Other tenant ${suffix}`, phone: `0120000${suffix.replace(/\D/g, "").padEnd(4, "0").slice(0, 4)}` } });
  const noPermission = await user(a.id, a1.id, `none-${suffix}`, "STAFF", []);
  const appointmentStaff = await user(a.id, a1.id, `appointment-${suffix}`, "STAFF", ["APPOINTMENTS"]);
  const crmStaff = await user(a.id, a1.id, `crm-${suffix}`, "STAFF", ["CRM"]);
  const owner = await user(a.id, a1.id, `owner-${suffix}`, "BUSINESS_OWNER", []);
  const deniedToken = await tokenFor(noPermission, a.id, a1.id);
  const appointmentToken = await tokenFor(appointmentStaff, a.id, a1.id);
  const crmToken = await tokenFor(crmStaff, a.id, a1.id);
  const ownerToken = await tokenFor(owner, a.id, a1.id);
  const port = await freePort();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, SESSION_SECRET: secret, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, token: string, body?: object) => fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { cookie: `${SESSION_COOKIE}=${token}`, ...(body ? { "content-type": "application/json", origin: base } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  try {
    await waitReady(base, child, () => output);
    const phone = `0110000${suffix.replace(/\D/g, "").padEnd(4, "1").slice(0, 4)}`;
    const createBody = { name: `Denied customer ${suffix}`, phone };
    assert.equal((await request("/api/appointments/customers", deniedToken, createBody)).status, 403, "unprivileged customer create must deny");
    assert.equal(await database.customer.count({ where: { businessId: a.id, phone } }), 0, "denied create must not write");
    assert.equal((await request("/api/appointments/vehicles", deniedToken, { ...createBody, plateNumber: `PICKER${suffix}` })).status, 403, "unprivileged vehicle create must deny");
    assert.equal(await database.vehicle.count({ where: { businessId: a.id } }), 0, "denied vehicle create must not write");
    assert.equal((await request("/api/customers/search?q=Other", deniedToken)).status, 403, "unprivileged customer search must deny");
    assert.equal((await request("/api/appointments/vehicles?q=PICKER", deniedToken)).status, 403, "unprivileged vehicle search must deny");

    const createdCustomer = await request("/api/appointments/customers", appointmentToken, { name: `Allowed customer ${suffix}`, phone });
    assert.equal(createdCustomer.status, 200, "appointment-capable staff may create picker customer");
    const createdCustomerBody = await createdCustomer.json();
    assert.equal(createdCustomerBody.ok, true);
    assert.equal((await request(`/api/customers/search?q=Allowed`, appointmentToken)).status, 200);
    assert.equal((await request(`/api/customers/search?q=Allowed`, crmToken)).status, 200);
    const crmCustomer = await request("/api/appointments/customers", crmToken, { name: `CRM customer ${suffix}`, phone: `0130000${suffix.replace(/\D/g, "").padEnd(4, "2").slice(0, 4)}` });
    assert.equal(crmCustomer.status, 200, "CRM-capable staff may create shared customer identity");
    const vehicle = await request("/api/appointments/vehicles", appointmentToken, { phone, plateNumber: `PICKER${suffix}` });
    assert.equal(vehicle.status, 200, "appointment-capable staff may create vehicle");
    assert.equal((await request(`/api/appointments/vehicles?q=PICKER`, appointmentToken)).status, 200);
    assert.equal((await request(`/api/customers/search?q=Allowed`, ownerToken)).status, 200);
    assert.equal((await request(`/api/appointments/vehicles?q=PICKER`, ownerToken)).status, 200);
    const ownerCreate = await request("/api/appointments/customers", ownerToken, { name: `Owner customer ${suffix}`, phone: `0140000${suffix.replace(/\D/g, "").padEnd(4, "3").slice(0, 4)}` });
    assert.equal(ownerCreate.status, 200, "owner may create within own business");
    assert.equal((await database.customer.count({ where: { businessId: a.id, name: `Owner customer ${suffix}` } })), 1);

    const beforeB = await database.customer.count({ where: { businessId: b.id } });
    const spoofedTenant = await request("/api/appointments/customers", appointmentToken, { name: `Spoofed tenant ${suffix}`, phone: `0150000${suffix.replace(/\D/g, "").padEnd(4, "4").slice(0, 4)}`, businessId: b.id });
    assert.equal(spoofedTenant.status, 200);
    assert.equal(await database.customer.count({ where: { businessId: b.id } }), beforeB, "body businessId cannot target tenant B");
    assert.equal(await database.customer.count({ where: { businessId: a.id, name: `Spoofed tenant ${suffix}` } }), 1);

    const crossTenantCustomer = await request(`/api/customers/search?q=${encodeURIComponent(existing.name)}`, appointmentToken);
    assert.equal(crossTenantCustomer.status, 200);
    assert.equal(JSON.stringify(await crossTenantCustomer.json()).includes(existing.id), false, "tenant B identity must not appear in tenant A search");
    const crossTenantVehicle = await request(`/api/appointments/vehicles?q=${encodeURIComponent(existing.name)}`, ownerToken);
    assert.equal(crossTenantVehicle.status, 200);
    assert.equal(JSON.stringify(await crossTenantVehicle.json()).includes(existing.name), false, "tenant B vehicle/customer must not appear in tenant A search");
    const tamperedContextToken = await tokenFor(appointmentStaff, b.id, b1.id);
    const crossTenantDirect = await request(`/api/customers/search?q=${encodeURIComponent(existing.name)}`, tamperedContextToken);
    assert.ok([401, 403].includes(crossTenantDirect.status), "staff from A cannot activate B via signed context");
    assert.equal((await crossTenantDirect.text()).includes(existing.name), false);
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    await database.$disconnect();
  }
});

async function user(businessId: string, branchId: string, prefix: string, role: "STAFF" | "BUSINESS_OWNER", permissions: string[]) {
  return database.user.create({ data: { businessId, branchId, name: prefix, email: `${prefix}@example.test`, role, permissions } });
}

async function tokenFor(subject: Awaited<ReturnType<typeof user>>, businessId: string, branchId: string) {
  const session = {
    userId: subject.id, sessionId: randomUUID(), homeBusinessId: businessId, activeBusinessId: businessId,
    contextVersion: 1, industryType: "SALON_BEAUTY" as const, branchId,
    name: subject.name, email: subject.email!, role: subject.role, permissions: subject.permissions, status: subject.status,
  };
  const stored = await persistSessionContext(session, { database });
  return createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
}

async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve())); return address.port;
}

async function waitReady(base: string, child: ReturnType<typeof spawn>, output: () => string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited: ${output().slice(-2500)}`);
    try { if ((await fetch(base + "/login", { signal: AbortSignal.timeout(3_000) })).ok) return; } catch { /* compiling */ }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Next server did not become ready: ${output().slice(-2500)}`);
}

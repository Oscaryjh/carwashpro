import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSessionToken, persistSessionContext, SESSION_COOKIE } from "../../src/lib/auth/session";

const database = new PrismaClient();
const secret = "authenticated-route-boundaries-secret-0123456789";

test("real signed sessions cannot cross People, Payroll, tenant or branch HTTP boundaries", { timeout: 180_000 }, async () => {
  assert.match(process.env.DATABASE_URL ?? "", /_disposable_/, "run only on a disposable database");
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  const suffix = randomUUID().slice(0, 8);
  const a = await database.business.create({ data: { name: `HTTP A ${suffix}`, slug: `http-a-${suffix}`, industryType: "SALON_BEAUTY" } });
  const b = await database.business.create({ data: { name: `HTTP B ${suffix}`, slug: `http-b-${suffix}`, industryType: "SALON_BEAUTY" } });
  const a1 = await database.branch.create({ data: { businessId: a.id, name: "A1" } });
  const a2 = await database.branch.create({ data: { businessId: a.id, name: "A2" } });
  const b1 = await database.branch.create({ data: { businessId: b.id, name: "B1" } });
  for (const moduleKey of ["HR", "PAYROLL"] as const) {
    await database.businessModuleEntitlement.create({ data: {
      businessId: a.id, moduleKey, status: "ENABLED", enabledFrom: new Date("2026-01-01T00:00:00.000Z"), source: "MANUAL",
    } });
  }
  const reader = await createUser(a.id, a1.id, `reader-${suffix}`, ["TEAM_READ"]);
  const denied = await createUser(a.id, a1.id, `denied-${suffix}`, []);
  const branchManager = await createUser(a.id, a1.id, `manager-${suffix}`, ["PAYROLL_READ", "VIEW_PAYSLIP"]);
  const groupManager = await database.user.create({ data: { name: `Group manager ${suffix}`, email: `group-${suffix}@example.test`, role: "STAFF", permissions: [] } });
  const group = await database.businessGroup.create({ data: { name: `HTTP Group ${suffix}`, code: `http-group-${suffix}` } });
  await database.businessGroupMember.create({ data: { groupId: group.id, businessId: a.id } });
  await database.businessGroupUser.create({ data: {
    groupId: group.id, userId: groupManager.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES",
    businessAccesses: { create: { businessId: a.id } },
  } });
  const sameBranch = await createUser(a.id, a1.id, `same-${suffix}`, []);
  const otherBranch = await createUser(a.id, a2.id, `branch-${suffix}`, []);
  const otherTenant = await createUser(b.id, b1.id, `tenant-${suffix}`, []);
  const readerToken = await tokenFor(reader, a.id, a1.id, ["TEAM_READ"]);
  const deniedToken = await tokenFor(denied, a.id, a1.id, []);
  const managerToken = await tokenFor(branchManager, a.id, a1.id, ["PAYROLL_READ", "VIEW_PAYSLIP"]);
  const groupToken = await tokenFor(groupManager, a.id, null, [], null);
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
  try {
    await waitReady(base, child, () => output);
    const request = (path: string, token: string) => fetch(base + path, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      redirect: "manual",
    });
    const own = await request(`/team/people/${sameBranch.id}`, readerToken);
    assert.equal(own.status, 200, `same branch: ${output.slice(-1800)}`);
    const noPermission = await request(`/team/people/${sameBranch.id}`, deniedToken);
    assert.equal(noPermission.status, 307);
    const crossBranch = await request(`/team/people/${otherBranch.id}`, readerToken);
    const crossBranchBody = await crossBranch.text();
    assert.ok([200, 404].includes(crossBranch.status));
    assert.match(crossBranchBody, /NEXT_HTTP_ERROR_FALLBACK;404|404: This page could not be found/);
    assert.equal(crossBranchBody.includes(otherBranch.name), false, "cross-branch employee data must not be serialized");
    const crossTenant = await request(`/team/people/${otherTenant.id}`, readerToken);
    const crossTenantBody = await crossTenant.text();
    assert.ok([200, 404].includes(crossTenant.status));
    assert.match(crossTenantBody, /NEXT_HTTP_ERROR_FALLBACK;404|404: This page could not be found/);
    assert.equal(crossTenantBody.includes(otherTenant.name), false, "cross-tenant employee data must not be serialized");
    const payroll = await request("/team/payroll", readerToken);
    assert.equal(payroll.status, 307);
    const bank = await request(`/team/people/${sameBranch.id}/payroll/bank/edit`, readerToken);
    assert.equal(bank.status, 307);
    const branchPayroll = await request(`/team/payroll/payslips/${randomUUID()}`, managerToken);
    assert.equal(branchPayroll.status, 307);
    assert.match(branchPayroll.headers.get("location") ?? "", /Payroll%20requires%20all-branch%20access/);
    const groupBank = await request(`/team/people/${sameBranch.id}/payroll/bank/edit`, groupToken);
    assert.equal(groupBank.status, 307);
    assert.match(groupBank.headers.get("location") ?? "", /business-access-denied/);
    const unauthenticated = await fetch(base + `/team/people/${sameBranch.id}`, { redirect: "manual" });
    assert.equal(unauthenticated.status, 307);
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
    await database.$disconnect();
  }
});

async function createUser(businessId: string, branchId: string, prefix: string, permissions: string[]) {
  return database.user.create({ data: { businessId, branchId, name: prefix, email: `${prefix}@example.test`, role: "STAFF", permissions } });
}

async function tokenFor(user: Awaited<ReturnType<typeof createUser>>, businessId: string, branchId: string | null, permissions: string[], homeBusinessId: string | null = businessId) {
  const session = {
    userId: user.id,
    sessionId: randomUUID(),
    homeBusinessId,
    activeBusinessId: businessId,
    contextVersion: 1,
    industryType: "SALON_BEAUTY" as const,
    branchId,
    name: user.name,
    email: user.email!,
    role: user.role,
    permissions,
    status: user.status,
  };
  const stored = await persistSessionContext(session, { database });
  return createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitReady(base: string, child: ReturnType<typeof spawn>, output: () => string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited: ${output().slice(-2500)}`);
    try {
      const response = await fetch(base + "/login", { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch { /* compiling */ }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Next server did not become ready: ${output().slice(-2500)}`);
}

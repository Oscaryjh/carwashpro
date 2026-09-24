import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { EMPLOYEE_SESSION_COOKIE, getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { createEmployeeSessionRecord } from "../../src/lib/attendance/employee-auth/session";
import { deleteRuntimeEmployeeAvatarByUrl, readRuntimeEmployeeAvatar } from "../../src/lib/runtime-employee-avatar";

const database = new PrismaClient();
const MAX_BYTES = 10 * 1024 * 1024;
const sharpNative = sharp as unknown as {
  (input: Buffer): { metadata(): Promise<{ format?: string; width?: number; height?: number }> };
  (input: { create: { width: number; height: number; channels: number; background: { r: number; g: number; b: number; alpha: number } } }): {
    toFormat(format: "jpeg" | "png" | "webp" | "avif"): { toBuffer(): Promise<Buffer> };
  };
};
const HEVC_HEIC = Buffer.from(
  "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXttZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABnwABAAAAAAAAAGwAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA+2lwcnAAAADbaXBjbwAAAHZodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQAqQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbq5Ka5uAhoMCAAAAMDIAAAAwAhYgABAAZEAcFzwIkAAAATY29scm5jbHgAAQANAAaAAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAoY2xhcAAAACAAAAABAAAAIAAAAAH////gAAAAAv///+AAAAACAAAADnBpeGkAAAAAAQgAAAAYaXBtYQAAAAAAAAABAAEFgQIDBYQAAAB0bWRhdAAAAGgoAa8TgPUrAhGDczL1mz4HCRRzxqbGjnnUrr1cLTO799zRz6nw0QjRMp+4I2Da10D3ghQEMvB53CWoI0S3qXIb99YsvLFaQ9ZLHxsJsZ9SxlvNJ5EgD4Y4miuaKu3bxPGXDHirp/9TzA==",
  "base64",
);

test("Staff avatar upload keeps auth and image decoding boundaries", async (t) => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname), "Avatar integration test requires a loopback database");
  assert.match(databaseUrl.pathname, /^\/tetamu_(?:pcb_verification_vc1|performance)_disposable_\d+_\d+$/, "Avatar integration test requires a disposable database");
  const previousSecret = process.env.EMPLOYEE_AUTH_SECRET;
  process.env.EMPLOYEE_AUTH_SECRET = "employee-avatar-security-disposable-secret-2026";
  const marker = randomUUID();
  let businessId: string | null = null;
  let accountId: string | null = null;
  let membershipId: string | null = null;
  let branchId: string | null = null;
  let token: string | null = null;
  let app: ChildProcess | null = null;
  let baseUrl = "";
  const createdAvatars: string[] = [];

  try {
    const business = await database.business.create({
      data: { name: `Avatar Security ${marker}`, slug: `avatar-security-${marker}` },
    });
    businessId = business.id;
    const branch = await database.branch.create({
      data: { businessId: business.id, name: `Avatar Branch ${marker}` },
    });
    branchId = branch.id;
    const phone = `+60${Math.floor(100000000 + Math.random() * 900000000)}`;
    const account = await database.employeeAccount.create({
      data: { phoneNumber: phone, phoneNormalized: phone, name: "Avatar Test Staff" },
    });
    accountId = account.id;
    const membership = await database.employeeBusinessMembership.create({
      data: {
        employeeAccountId: account.id,
        businessId: business.id,
        employeeCode: `AV-${marker.slice(0, 8)}`,
        fullName: "Avatar Test Staff",
        phoneNumber: phone,
        phoneNumberNormalized: phone,
        employmentType: "FULL_TIME",
        status: "ACTIVE",
        attendanceEnabled: false,
      },
    });
    membershipId = membership.id;
    await database.employeeBranchAssignment.create({
      data: {
        membershipId: membership.id,
        businessId: business.id,
        branchId: branch.id,
        isPrimary: true,
        canClockIn: true,
        effectiveFrom: new Date(Date.now() - 60_000),
        status: "ACTIVE",
      },
    });
    await database.employeeBusinessMembership.update({
      where: { id: membership.id }, data: { attendanceEnabled: true },
    });
    const device = await database.employeeDevice.create({
      data: { employeeAccountId: account.id, deviceIdentifierHash: marker },
    });
    const session = await database.$transaction((transaction) =>
      createEmployeeSessionRecord(
        {
          employeeAccountId: account.id,
          membershipId: membership.id,
          businessId: business.id,
          primaryBranchId: branch.id,
          deviceId: device.id,
          now: new Date(),
        },
        transaction,
        getEmployeeAuthConfig(),
      ),
    );
    token = session.token;
    ({ app, baseUrl } = await startApp());

    await t.test("missing Staff session rejects before a valid JPEG is decoded or saved", async () => {
      const jpeg = await image("jpeg");
      const response = await uploadAvatar(baseUrl, jpeg, "image/jpeg");
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
      assert.equal((await database.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: membership.id }, select: { avatarUrl: true },
      })).avatarUrl, null);
    });

    await t.test("authenticated Staff JPEG, PNG, WebP, AVIF and HEIF become 512px WebP", async () => {
      const avif = await image("avif");
      const heifAv1 = await image("avif", { r: 90, g: 25, b: 170 });
      assert.notDeepEqual(heifAv1, avif, "HEIF-family AV1 must use an independent fixture");
      const samples = [
        { label: "JPEG", bytes: await image("jpeg"), type: "image/jpeg" },
        { label: "PNG", bytes: await image("png"), type: "image/png" },
        { label: "WebP", bytes: await image("webp"), type: "image/webp" },
        { label: "AVIF", bytes: avif, type: "image/avif" },
        { label: "HEIF-family AV1", bytes: heifAv1, type: "image/heif" },
      ];
      for (const sample of samples) {
        const response = await uploadAvatar(baseUrl, sample.bytes, sample.type, token);
        assert.equal(response.status, 200, sample.label);
        const body = await response.json();
        assert.equal(body.ok, true, sample.label);
        assert.match(body.avatarUrl, /^\/uploads\/employee-avatars\/.*\.webp$/, sample.label);
        createdAvatars.push(body.avatarUrl);
        const filename = body.avatarUrl.split("/").at(-1);
        assert.ok(filename);
        const saved = await readRuntimeEmployeeAvatar(filename);
        assert.ok(saved, sample.label);
        const metadata = await sharpNative(saved).metadata();
        assert.equal(metadata.format, "webp", sample.label);
        assert.equal(metadata.width, 512, sample.label);
        assert.equal(metadata.height, 512, sample.label);
      }
    });

    await t.test("corrupt, oversized and unsupported images fail without internal errors or avatar changes", async () => {
      const before = await database.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: membership.id }, select: { avatarUrl: true },
      });
      for (const sample of [
        { bytes: Buffer.from("not an image\0<script>"), type: "image/jpeg", status: 400 },
        { bytes: Buffer.alloc(MAX_BYTES + 1), type: "image/png", status: 400 },
        { bytes: await image("jpeg"), type: "application/octet-stream", status: 400 },
      ]) {
        const response = await uploadAvatar(baseUrl, sample.bytes, sample.type, token);
        assert.equal(response.status, sample.status);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.doesNotMatch(JSON.stringify(body), /stack|libvips|sharp|RangeError|<script>/i);
        assert.equal((await database.employeeBusinessMembership.findUniqueOrThrow({
          where: { id: membership.id }, select: { avatarUrl: true },
        })).avatarUrl, before.avatarUrl);
      }
    });

    await t.test("HEIC is explicitly rejected without changing the Staff avatar", async () => {
      const before = await database.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: membership.id }, select: { avatarUrl: true },
      });
      for (const sample of [
        { type: "image/heic", name: "avatar.heic" },
        { type: "", name: "iphone-photo.HEIC" },
      ]) {
        const response = await uploadAvatar(baseUrl, HEVC_HEIC, sample.type, token, sample.name);
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.doesNotMatch(JSON.stringify(body), /stack|libvips|sharp|RangeError/i);
        assert.equal(body.ok, false);
        assert.equal(body.error.code, "INVALID_REQUEST");
        assert.equal(body.error.message, "HEIC is not supported yet. Please use JPEG, PNG, WebP or AVIF.");
        assert.equal((await database.employeeBusinessMembership.findUniqueOrThrow({
          where: { id: membership.id }, select: { avatarUrl: true },
        })).avatarUrl, before.avatarUrl);
      }
    });
  } finally {
    stopApp(app);
    try {
      for (const url of createdAvatars) await deleteRuntimeEmployeeAvatarByUrl(url);
      if (businessId) await database.auditLog.deleteMany({ where: { businessId } });
      if (accountId) {
        await database.employeeSession.deleteMany({ where: { employeeAccountId: accountId } });
        await database.employeeDevice.deleteMany({ where: { employeeAccountId: accountId } });
      }
      if (membershipId) {
        await database.employeeBusinessMembership.update({
          where: { id: membershipId }, data: { attendanceEnabled: false },
        });
        await database.employeeBranchAssignment.deleteMany({ where: { membershipId } });
        await database.employeeBusinessMembership.deleteMany({ where: { id: membershipId } });
      }
      if (accountId) await database.employeeAccount.deleteMany({ where: { id: accountId } });
      if (branchId) await database.branch.deleteMany({ where: { id: branchId } });
      if (businessId) await database.business.deleteMany({ where: { id: businessId } });
    } finally {
      try {
        await database.$disconnect();
      } finally {
        if (previousSecret === undefined) delete process.env.EMPLOYEE_AUTH_SECRET;
        else process.env.EMPLOYEE_AUTH_SECRET = previousSecret;
      }
    }
  }
});

function uploadAvatar(baseUrl: string, bytes: Buffer, type: string, token?: string | null, filename = "avatar") {
  const form = new FormData();
  form.set("avatar", new File([new Uint8Array(bytes)], filename, { type }));
  return fetch(`${baseUrl}/api/employee-auth/avatar`, {
    method: "POST",
    headers: {
      origin: baseUrl,
      ...(token ? { cookie: `${EMPLOYEE_SESSION_COOKIE}=${token}` } : {}),
    },
    body: form,
  });
}

async function startApp() {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No local test port"));
      server.close(() => resolve(address.port));
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, TETAMU_ENVIRONMENT: "", NEXT_TELEMETRY_DISABLED: "1" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout?.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4000); });
  app.stderr?.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4000); });
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (app.exitCode !== null) throw new Error(`Local Next test server exited: ${output}`);
      try {
        const response = await fetch(`${baseUrl}/login`);
        if (response.status < 500) return { app, baseUrl };
      } catch { /* wait until Next is ready */ }
      await delay(500);
    }
    throw new Error(`Local Next test server did not become ready: ${output}`);
  } catch (error) {
    stopApp(app);
    throw error;
  }
}

function stopApp(app: ChildProcess | null) {
  if (!app?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-app.pid, "SIGTERM"); } catch { app.kill(); }
  }
}

function image(format: "jpeg" | "png" | "webp" | "avif", background = { r: 20, g: 80, b: 140 }) {
  return sharpNative({
    create: { width: 8, height: 6, channels: 4, background: { ...background, alpha: 1 } },
  }).toFormat(format).toBuffer();
}

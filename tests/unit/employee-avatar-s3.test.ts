import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const FILENAME = "267edffd-e401-4287-baf4-8875238bd0f5.webp";
const BYTES = Buffer.from("synthetic-normalized-webp");

class FakeAvatarS3 {
  readonly objects = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();
  readonly commands: Array<{ kind: string; key: string }> = [];
  failure: Error | null = null;

  async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
    if (this.failure) throw this.failure;
    const key = command.input.Key ?? "";
    this.commands.push({ kind: command.constructor.name, key });
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.ContentType, "image/webp");
      assert.equal(command.input.IfNoneMatch, "*");
      this.objects.set(key, {
        bytes: Buffer.from(command.input.Body as Buffer),
        metadata: command.input.Metadata ?? {},
      });
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {
        ContentLength: object.bytes.length,
        ContentType: "image/webp",
        Metadata: object.metadata,
        Body: { transformToByteArray: async () => new Uint8Array(object.bytes) },
      };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    throw new Error("Unexpected command");
  }
}

function config() {
  return {
    endpoint: "https://t3.storageapi.dev",
    region: "auto",
    bucket: "tetamu-avatar-private",
    accessKeyId: "test-id",
    secretAccessKey: "test-secret",
    objectPrefix: "testing/private-avatars",
  };
}

test("private S3 avatar store shares bytes through a fixed namespace without exposing credentials", async () => {
  const { S3EmployeeAvatarObjectStore } = await import("../../src/lib/employee-avatar-s3");
  const fake = new FakeAvatarS3();
  const staff = new S3EmployeeAvatarObjectStore(config(), { client: fake });
  const web = new S3EmployeeAvatarObjectStore(config(), { client: fake });

  await staff.put(FILENAME, BYTES);
  assert.deepEqual(await web.read(FILENAME), BYTES);
  assert.equal(fake.objects.size, 1);
  assert.ok(fake.objects.has(`testing/private-avatars/employee-avatars/${FILENAME}`));
  assert.equal(fake.objects.values().next().value?.metadata.sha256, createHash("sha256").update(BYTES).digest("hex"));
  assert.equal(JSON.stringify(fake.commands).includes("test-secret"), false);
});

test("avatar S3 store rejects traversal before making any provider call", async () => {
  const { S3EmployeeAvatarObjectStore } = await import("../../src/lib/employee-avatar-s3");
  const fake = new FakeAvatarS3();
  const store = new S3EmployeeAvatarObjectStore(config(), { client: fake });
  await assert.rejects(() => store.read("../../claim-receipts/secret.pdf"));
  await assert.rejects(() => store.put("avatar%2fsecret.webp", BYTES));
  assert.equal(fake.commands.length, 0);
});

test("avatar S3 store distinguishes missing object from provider outage", async () => {
  const { S3EmployeeAvatarObjectStore } = await import("../../src/lib/employee-avatar-s3");
  const fake = new FakeAvatarS3();
  const store = new S3EmployeeAvatarObjectStore(config(), { client: fake });
  assert.equal(await store.read(FILENAME), null);
  fake.failure = Object.assign(new Error("provider unavailable"), { name: "ServiceUnavailable" });
  await assert.rejects(() => store.read(FILENAME), /provider unavailable/);
});

test("avatar S3 configuration rejects unsafe endpoints and prefixes", async () => {
  const { S3EmployeeAvatarObjectStore } = await import("../../src/lib/employee-avatar-s3");
  assert.throws(() => new S3EmployeeAvatarObjectStore({ ...config(), endpoint: "http://example.test" }));
  assert.throws(() => new S3EmployeeAvatarObjectStore({ ...config(), objectPrefix: "../claims" }));
  assert.throws(() => new S3EmployeeAvatarObjectStore({ ...config(), secretAccessKey: "" }));
});

test("production and Testing avatar storage fail closed without explicit private S3 config", async () => {
  const { getEmployeeAvatarObjectStore } = await import("../../src/lib/employee-avatar-s3");
  assert.throws(() => getEmployeeAvatarObjectStore({ NODE_ENV: "production", APP_ENVIRONMENT: "production" }));
  assert.throws(() => getEmployeeAvatarObjectStore({ NODE_ENV: "production", APP_ENVIRONMENT: "testing" }));
  assert.throws(() => getEmployeeAvatarObjectStore({ NODE_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "testing" }));
  assert.throws(() => getEmployeeAvatarObjectStore({ NODE_ENV: "production", APP_ENVIRONMENT: "production", EMPLOYEE_AVATAR_STORAGE_PROVIDER: "filesystem" }));
});

test("avatar S3 object integrity and bounds fail closed", async () => {
  const { S3EmployeeAvatarObjectStore } = await import("../../src/lib/employee-avatar-s3");
  const fake = new FakeAvatarS3();
  const store = new S3EmployeeAvatarObjectStore(config(), { client: fake });
  await store.put(FILENAME, BYTES);
  const saved = fake.objects.values().next().value;
  assert.ok(saved);
  saved.metadata.sha256 = "0".repeat(64);
  await assert.rejects(() => store.read(FILENAME), /integrity/);
  await assert.rejects(() => store.put(FILENAME, Buffer.alloc(4 * 1024 * 1024 + 1)));
});

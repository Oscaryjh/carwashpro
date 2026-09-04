import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  getPublicImageStorageConfig, publicImageContentType, readLegacyPublicImage,
  readPublicImage, writePublicImage, deletePublicImageByUrl,
} from "../../src/lib/runtime-public-images";

const OWNER = "83466c71-1675-470b-acb1-9217e0aa7b19";
const FILE = `${OWNER}-26a2fa1b-4bf0-4a70-9a43-2180171f5f07.webp`;
const WEBP = Buffer.from("RIFF0000WEBPtest");
const ENV = {
  APP_ENVIRONMENT: "testing", PUBLIC_IMAGE_STORAGE_PROVIDER: "s3",
  PUBLIC_IMAGE_S3_ENDPOINT: "https://storage.example.com", PUBLIC_IMAGE_S3_REGION: "auto",
  PUBLIC_IMAGE_S3_BUCKET: "test-bucket", PUBLIC_IMAGE_S3_ACCESS_KEY_ID: "test-key",
  PUBLIC_IMAGE_S3_SECRET_ACCESS_KEY: "test-secret", PUBLIC_IMAGE_S3_PREFIX: "public-images/testing/v1",
  PUBLIC_IMAGE_BASE_URL: "https://staff.example.com", PUBLIC_IMAGE_LEGACY_ORIGIN: "https://pos.example.com",
};

test("public image keys cannot address private attachments or arbitrary paths", () => {
  assert.equal(publicImageContentType("employee-avatars", FILE), "image/webp");
  for (const filename of ["../../receipt.pdf", "claim-receipts/a.webp", `${FILE}?path=secret`, `${FILE}%2f..`, FILE.replace("webp", "svg")]) {
    assert.equal(publicImageContentType("employee-avatars", filename), null);
  }
  assert.equal(publicImageContentType("employee-avatars", FILE.replace("webp", "jpg")), null);
  assert.equal(publicImageContentType("business-logos", FILE.replace("webp", "jpg")), "image/jpeg");
});

test("cloud image config fails closed on incomplete, private-prefix and wrong-environment configuration", () => {
  assert.equal(getPublicImageStorageConfig({}), null);
  assert.equal(getPublicImageStorageConfig(ENV)?.prefix, "public-images/testing/v1");
  for (const change of [
    { PUBLIC_IMAGE_S3_PREFIX: "claim-receipts/testing" },
    { PUBLIC_IMAGE_S3_PREFIX: "public-images/testing/v1/../../private" },
    { PUBLIC_IMAGE_S3_PREFIX: "public-images/production/v1" },
    { PUBLIC_IMAGE_S3_SECRET_ACCESS_KEY: "" },
    { PUBLIC_IMAGE_S3_ENDPOINT: "http://storage.example.com" },
    { PUBLIC_IMAGE_BASE_URL: "https://user:pass@staff.example.com/" },
  ]) assert.throws(() => getPublicImageStorageConfig({ ...ENV, ...change }));
});

test("legacy images use a fixed origin without credentials, redirects or recursive forwarding", async () => {
  let calls = 0;
  const image = await readLegacyPublicImage("business-logos", FILE, {
    env: ENV,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, `https://pos.example.com/uploads/business-logos/${FILE}`);
      assert.equal(init?.redirect, "manual");
      assert.deepEqual(init?.headers, { "x-tetamu-image-fallback": "1" });
      assert.equal(init?.credentials, undefined);
      return new Response(WEBP, { headers: { "content-type": "image/webp" } });
    },
  });
  assert.deepEqual(image?.bytes, WEBP);
  assert.equal(calls, 1);
  const noFetch = async () => { throw new Error("Must not fetch"); };
  assert.equal(await readLegacyPublicImage("business-logos", "../../secret", { env: ENV, fetcher: noFetch }), null);
  assert.equal(await readLegacyPublicImage("business-logos", FILE, { env: { ...ENV, PUBLIC_IMAGE_LEGACY_ORIGIN: ENV.PUBLIC_IMAGE_BASE_URL }, fetcher: noFetch }), null);
});

test("legacy fallback rejects HTML, redirects, invalid signatures and oversized files", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    new Response("not an image", { headers: { "content-type": "image/webp" } }),
    new Response(WEBP, { headers: { "content-type": "image/webp", "content-length": "99999999" } }),
  ]) {
    await assert.rejects(readLegacyPublicImage("business-logos", FILE, { env: ENV, fetcher: async () => response }));
  }
  assert.equal(await readLegacyPublicImage("business-logos", FILE, { env: ENV, fetcher: async () => new Response(null, { status: 404 }) }), null);
});

test("cloud images survive new clients and absolute avatar URLs can be deleted without touching other keys", async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, ENV);
  const objects = new Map<string, Buffer>();
  const accessed: string[] = [];
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.IfNoneMatch, "*");
      objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      accessed.push(command.input.Key!);
      const bytes = objects.get(command.input.Key!);
      if (!bytes) throw Object.assign(new Error("Missing"), { name: "NoSuchKey" });
      return { ContentType: "image/webp", ContentLength: bytes.length, Body: { transformToWebStream: () => new Response(new Uint8Array(bytes)).body } };
    }
    if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
    throw new Error("Unexpected command");
  });
  try {
    const saved = await writePublicImage({ namespace: "employee-avatars", ownerId: OWNER, bytes: WEBP, extension: "webp" });
    assert.ok(saved.url.startsWith("https://staff.example.com/uploads/employee-avatars/"));
    assert.deepEqual((await readPublicImage("employee-avatars", saved.filename))?.bytes, WEBP);
    assert.deepEqual(accessed, [`public-images/testing/v1/employee-avatars/${saved.filename}`]);
    await deletePublicImageByUrl("employee-avatars", saved.url.replace("staff.example.com", "untrusted.example.com"));
    assert.equal(objects.size, 1);
    await deletePublicImageByUrl("employee-avatars", saved.url);
    assert.equal(objects.size, 0);
    assert.equal(await readPublicImage("employee-avatars", saved.filename, undefined, false), null);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("Railway uploads without durable storage fail rather than claiming a temporary file was saved", async () => {
  const previous = { ...process.env };
  delete process.env.PUBLIC_IMAGE_STORAGE_PROVIDER;
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  process.env.RAILWAY_ENVIRONMENT_ID = "test-environment";
  try {
    await assert.rejects(writePublicImage({ namespace: "employee-avatars", ownerId: OWNER, bytes: WEBP, extension: "webp" }), /Persistent public image storage/);
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/unrelated-private-volume";
    await assert.rejects(writePublicImage({ namespace: "employee-avatars", ownerId: OWNER, bytes: WEBP, extension: "webp" }), /Persistent public image storage/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("Staff identity components use failure-safe images and an honest restore-photo message", () => {
  const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const image = source("src/components/staff-pwa/staff-image.tsx");
  assert.match(image, /failedSource === src/);
  assert.match(image, /onError=\{unavailable\}/);
  assert.match(image, /naturalWidth === 0/);
  for (const file of ["staff-home-overview", "staff-pwa-chrome", "staff-avatar-upload"]) {
    assert.match(source(`src/components/staff-pwa/${file}.tsx`), /<StaffImage/);
  }
  assert.match(source("src/components/staff-pwa/staff-avatar-upload.tsx"), /Your saved photo is unavailable/);
  for (const namespace of ["employee-avatars", "business-logos", "staff-app-logos"]) {
    assert.match(source(`src/app/uploads/${namespace}/[filename]/route.ts`), /x-tetamu-image-fallback/);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { signOutAndNavigate } from "../../src/lib/auth/sign-out-client";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

test("sign out requests explicit acknowledgement before replacing the authenticated page", async () => {
  const events: string[] = [];
  await signOutAndNavigate(async (url, options) => {
    assert.equal(url, "/logout");
    assert.equal(options?.method, "POST");
    assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("accept"), "application/json");
    events.push("revoked");
    return Response.json({ ok: true });
  }, (url) => { assert.equal(url, "/login"); events.push("navigate"); });
  assert.deepEqual(events, ["revoked", "navigate"]);
});

test("sign out does not claim success or navigate on denied, failed or unacknowledged results", async () => {
  for (const response of [new Response("Denied", { status: 403 }), new Response("Error", { status: 500 }), Response.json({ ok: false }), new Response("HTML")]) {
    let navigated = false;
    await assert.rejects(signOutAndNavigate(async () => response, () => { navigated = true; }));
    assert.equal(navigated, false);
  }
  let navigated = false;
  await assert.rejects(signOutAndNavigate(async () => { throw new Error("Network unavailable"); }, () => { navigated = true; }));
  assert.equal(navigated, false);
});

test("shared sign out UI keeps the native POST fallback and existing button styling", async () => {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/signout-ui-"));
  try {
    const outfile = join(directory, "ui.cjs");
    await build({ entryPoints: ["src/components/sign-out-form.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile });
    const { SignOutForm } = createRequire(import.meta.url)(outfile);
    const html = renderToStaticMarkup(createElement(SignOutForm));
    assert.match(html, /action="\/logout"/);
    assert.match(html, /method="post"/);
    assert.match(html, /class="secondary-button"/);
    assert.match(html, />Sign out</);
    assert.doesNotMatch(html, /disabled|role="alert"/);
    assert.match(renderToStaticMarkup(createElement(SignOutForm, { buttonClassName: "button-link" })), /class="button-link"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unresponsive logout request becomes retryable without claiming success", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let navigated = false;
  const result = signOutAndNavigate(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("Request timed out")), { once: true });
  }), () => { navigated = true; });
  const rejection = assert.rejects(result, /timed out/);
  context.mock.timers.tick(15_000);
  await rejection;
  assert.equal(navigated, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { config, middleware } from "../../src/middleware";

const ACCESS_USERNAME = "uat-reviewer";
const ACCESS_PASSWORD = "preview-access-password-that-is-long-enough";
const ENVIRONMENT_KEYS = [
  "APP_ENVIRONMENT",
  "NODE_ENV",
  "RAILWAY_DEPLOYMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "SESSION_SECRET",
  "TETAMU_APP_SURFACE",
  "UAT_PREVIEW_ACCESS_ENABLED",
  "UAT_PREVIEW_ACCESS_PASSWORD",
  "UAT_PREVIEW_ACCESS_USERNAME",
] as const;

test("Preview gate protects Desktop, Staff, APIs, and direct deep links", async () => {
  await withEnvironment(previewEnvironment(), async () => {
    for (const pathname of [
      "/login",
      "/team",
      "/staff/login",
      "/api/employee-auth/me",
      "/team/employee/direct-deep-link",
    ]) {
      const response = await middleware(request(pathname));
      assert.equal(response.status, 401, pathname);
      assert.equal(
        response.headers.get("www-authenticate"),
        'Basic realm="TETAMU UAT Preview", charset="UTF-8"',
        pathname,
      );
      const body = await response.text();
      assert.equal(body, "UAT Preview access required.");
      assert.equal(body.includes(ACCESS_USERNAME), false);
      assert.equal(body.includes(ACCESS_PASSWORD), false);
    }

    const wrong = await middleware(
      request("/staff/login", basicAuthorization("wrong", "wrong-password")),
    );
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.text()).includes("wrong"), false);
  });
});

test("valid outer access continues to existing application login and RBAC", async () => {
  await withEnvironment(previewEnvironment(), async () => {
    const authorization = basicAuthorization(ACCESS_USERNAME, ACCESS_PASSWORD);

    const publicLogin = await middleware(request("/login", authorization));
    assert.equal(publicLogin.status, 200);
    assert.equal(publicLogin.headers.get("x-middleware-next"), "1");

    const protectedDesktop = await middleware(request("/team", authorization));
    assert.equal(protectedDesktop.status, 307);
    assert.equal(
      new URL(protectedDesktop.headers.get("location") ?? "", "http://localhost")
        .pathname,
      "/login",
      "Preview access must not replace application authentication",
    );

    for (const pathname of ["/staff/login", "/api/employee-auth/me"]) {
      const continued = await middleware(request(pathname, authorization));
      assert.equal(continued.status, 200, pathname);
      assert.equal(continued.headers.get("x-middleware-next"), "1", pathname);
      assert.equal(
        continued.headers.get("x-middleware-request-authorization"),
        null,
        "Preview access credentials must not be forwarded upstream",
      );
      const serializedHeaders = JSON.stringify([...continued.headers]);
      assert.equal(serializedHeaders.includes(ACCESS_USERNAME), false);
      assert.equal(serializedHeaders.includes(ACCESS_PASSWORD), false);
      assert.equal(serializedHeaders.includes(authorization), false);
    }
  });
});

test("Preview access misconfiguration and unknown runtime fail closed", async () => {
  for (const environment of [
    previewEnvironment({ UAT_PREVIEW_ACCESS_ENABLED: "false" }),
    previewEnvironment({ UAT_PREVIEW_ACCESS_PASSWORD: "short" }),
    previewEnvironment({ APP_ENVIRONMENT: "unexpected-preview-name" }),
  ]) {
    await withEnvironment(environment, async () => {
      const response = await middleware(
        request(
          "/staff/login",
          basicAuthorization(ACCESS_USERNAME, ACCESS_PASSWORD),
        ),
      );
      assert.equal(response.status, 503);
      assert.equal(await response.text(), "UAT Preview access unavailable.");
    });
  }
});

test("health, Next assets, and required metadata stay outside the Preview gate", async () => {
  await withEnvironment(
    previewEnvironment({ UAT_PREVIEW_ACCESS_ENABLED: "false" }),
    async () => {
      for (const pathname of [
        "/api/health",
        "/_next/static/chunks/app.js",
        "/_next/image?url=%2Fbrand%2Flogo.png&w=256&q=75",
        "/favicon.ico",
        "/robots.txt",
        "/sitemap.xml",
      ]) {
        const response = await middleware(request(pathname));
        assert.equal(response.status, 200, pathname);
        assert.equal(response.headers.get("x-middleware-next"), "1", pathname);
      }
    },
  );
});

test("expanded matcher protects application routes but excludes health and assets", () => {
  for (const url of [
    "https://preview.example/login",
    "https://preview.example/team/people",
    "https://preview.example/staff/login",
    "https://preview.example/api/employee-auth/me",
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
  }
  for (const url of [
    "https://preview.example/api/health",
    "https://preview.example/_next/static/chunks/app.js",
    "https://preview.example/_next/image?url=%2Flogo.png&w=64&q=75",
    "https://preview.example/favicon.ico",
    "https://preview.example/robots.txt",
    "https://preview.example/sitemap.xml",
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
  }
});

test("Testing and Production retain their pre-Preview middleware behavior", async () => {
  for (const applicationEnvironment of ["testing", "production"]) {
    await withEnvironment(
      {
        APP_ENVIRONMENT: applicationEnvironment,
        NODE_ENV: "production",
        SESSION_SECRET: "preview-access-non-regression-secret-long-enough",
      },
      async () => {
        const staffApi = await middleware(request("/api/employee-auth/me"));
        assert.equal(staffApi.status, 200, applicationEnvironment);
        assert.equal(staffApi.headers.get("x-middleware-next"), "1");

        const desktop = await middleware(request("/team"));
        assert.equal(desktop.status, 307, applicationEnvironment);
        assert.equal(
          new URL(desktop.headers.get("location") ?? "", "http://localhost")
            .pathname,
          "/login",
        );
      },
    );
  }
});

function request(pathname: string, authorization?: string) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

function basicAuthorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function previewEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    APP_ENVIRONMENT: "uat-preview",
    NODE_ENV: "production",
    SESSION_SECRET: "preview-access-application-session-secret-long-enough",
    UAT_PREVIEW_ACCESS_ENABLED: "true",
    UAT_PREVIEW_ACCESS_USERNAME: ACCESS_USERNAME,
    UAT_PREVIEW_ACCESS_PASSWORD: ACCESS_PASSWORD,
    ...overrides,
  };
}

async function withEnvironment(
  values: NodeJS.ProcessEnv,
  callback: () => Promise<void>,
) {
  const previous = Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of ENVIRONMENT_KEYS) delete process.env[key];
    Object.assign(process.env, values);
    await callback();
  } finally {
    for (const key of ENVIRONMENT_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: value });
    }
  }
}

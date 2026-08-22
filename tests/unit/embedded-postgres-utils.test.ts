import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

type ResolveDatabaseDirectory = (options?: {
  cwd?: string;
  configuredDirectory?: string;
  resolveGitCommonDirectory?: (cwd: string) => string;
}) => string;

const scriptUrl = new URL(
  "../../scripts/embedded-postgres-utils.mjs",
  import.meta.url,
);

async function loadResolver() {
  const utilities = await import(scriptUrl.href) as {
    resolveDatabaseDirectory: ResolveDatabaseDirectory;
  };
  return utilities.resolveDatabaseDirectory;
}

test("local Postgres data is shared by Git worktrees", async () => {
  const resolveDatabaseDirectory = await loadResolver();
  const cwd = resolve("C:/example/project-worktree");
  const sharedDirectory = resolveDatabaseDirectory({
    cwd,
    resolveGitCommonDirectory: () => resolve("C:/example/project/.git"),
  });

  assert.equal(
    sharedDirectory,
    resolve("C:/example/project/.local-postgres/data"),
  );
});

test("local Postgres data directory can be explicitly overridden", async () => {
  const resolveDatabaseDirectory = await loadResolver();
  const cwd = resolve("C:/example/project-worktree");

  assert.equal(
    resolveDatabaseDirectory({
      cwd,
      configuredDirectory: "../custom-postgres",
    }),
    resolve(cwd, "../custom-postgres"),
  );
});

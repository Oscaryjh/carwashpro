import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

test("WhatsApp worker TypeScript configuration resolves shared release boundaries", () => {
  const root = process.cwd();
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules", "tsx", "dist", "cli.mjs"), "-e", "import('./src/lib/whatsapp/connector-client.ts').then(() => console.log('IMPORT_OK'))"],
    {
      cwd: root,
      env: { ...process.env, TSX_TSCONFIG_PATH: join(root, "tsconfig.worker.json") },
      encoding: "utf8",
      timeout: 15_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /IMPORT_OK/);
});

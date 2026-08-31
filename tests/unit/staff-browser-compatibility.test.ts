import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { transformSync } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "../..");

test("Staff production build targets the Android Chrome 87 UAT device", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ) as { browserslist?: string[] };

  assert.ok(packageJson.browserslist?.includes("chrome 87"));
});

test("Next client error boundaries are lowered below class static blocks", () => {
  for (const filename of ["catch-error.js", "error-boundary.js"]) {
    const source = fs.readFileSync(
      path.join(
        projectRoot,
        "node_modules",
        "next",
        "dist",
        "client",
        "components",
        filename,
      ),
      "utf8",
    );
    const transformed = transformSync(source, {
      loader: "js",
      target: "chrome87",
    }).code;

    assert.doesNotMatch(transformed, /static\s*\{/);
  }
});

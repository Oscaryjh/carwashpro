import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  formatMalaysiaDateInput,
  normalizeMalaysiaDateInput,
  parseMalaysiaDateInput,
} from "../../src/lib/malaysia-date-input";

const workspace = process.cwd();

test("browser date controls and UI dates use the Malaysia locale", () => {
  const rootLayout = source("src/app/layout.tsx");
  assert.match(rootLayout, /<html\s+lang="en-MY"(?:\s[^>]*)?>/);

  const uiFiles = [...sourceFiles("src/app"), ...sourceFiles("src/components")];

  for (const file of uiFiles) {
    const content = readFileSync(file, "utf8");
    assert.doesNotMatch(
      content,
      /\.toLocale(?:Date|Time)String\(\)/,
      `${path.relative(workspace, file)} relies on the server or browser default locale`,
    );
  }
});

test("Malaysia date input converts safely between display and canonical values", () => {
  assert.equal(formatMalaysiaDateInput("2026-08-13"), "13/08/2026");
  assert.equal(normalizeMalaysiaDateInput("13082026"), "13/08/2026");
  assert.equal(normalizeMalaysiaDateInput("13-08-2026"), "13/08/2026");
  assert.equal(parseMalaysiaDateInput("13/08/2026"), "2026-08-13");
  assert.equal(parseMalaysiaDateInput("31/02/2026"), null);
  assert.equal(parseMalaysiaDateInput("08/13/2026"), null);
});

function source(relativePath: string) {
  return readFileSync(path.join(workspace, relativePath), "utf8");
}

function sourceFiles(relativeDirectory: string): string[] {
  const directory = path.join(workspace, relativeDirectory);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

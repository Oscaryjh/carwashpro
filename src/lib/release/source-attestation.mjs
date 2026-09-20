import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export function readSourceAttestation(root = process.cwd()) {
  try {
    const result = JSON.parse(readFileSync(join(root, ".release/source-attestation.json"), "utf8"));
    const lockfileHash = createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
    if (result.lockfileHash !== lockfileHash) return null;
    return result;
  } catch { return null; }
}

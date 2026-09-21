import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const HEX = (length) => new RegExp(`^[a-f0-9]{${length}}$`, "i");
export const BUILD_ATTESTATION_VERSION = 1;

const digest = (value) => createHash("sha256").update(value).digest("hex");

function collectFiles(root, current = root, result = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if ([".git", ".next", "node_modules", ".release", "coverage", "dist", "tsconfig.tsbuildinfo"].includes(entry.name)) continue;
    const path = join(current, entry.name);
    const rel = relative(root, path).split("\\").join("/");
    if (entry.isSymbolicLink()) throw new Error(`BUILD_CONTEXT_SYMLINK:${rel}`);
    if (entry.isDirectory()) collectFiles(root, path, result);
    else if (entry.isFile()) result.push({ path: rel, bytes: readFileSync(path) });
    else throw new Error(`BUILD_CONTEXT_SPECIAL_FILE:${rel}`);
  }
  return result;
}

export function computeBuildContextDigest(root = process.cwd()) {
  const records = collectFiles(root).sort((a, b) => a.path.localeCompare(b.path));
  const canonical = records.map(({ path, bytes }) => `${path}\0${bytes.length}\0${digest(bytes)}\0`).join("");
  return digest(canonical);
}

export function parseImmutablePublicationManifest(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("IMMUTABLE_MANIFEST_MISSING");
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw new Error("IMMUTABLE_MANIFEST_INVALID"); }
  if (!manifest || manifest.version !== BUILD_ATTESTATION_VERSION ||
      !HEX(40).test(manifest.commitSha) || !HEX(40).test(manifest.tree) ||
      !HEX(64).test(manifest.sourceDigest) || !HEX(64).test(manifest.lockfileHash) ||
      !HEX(64).test(manifest.buildContextDigest)) throw new Error("IMMUTABLE_MANIFEST_INVALID");
  return Object.freeze({
    version: BUILD_ATTESTATION_VERSION,
    commitSha: manifest.commitSha.toLowerCase(),
    tree: manifest.tree.toLowerCase(),
    sourceDigest: manifest.sourceDigest.toLowerCase(),
    lockfileHash: manifest.lockfileHash.toLowerCase(),
    buildContextDigest: manifest.buildContextDigest.toLowerCase(),
  });
}

export function writeAttestationError(root, code) {
  mkdirSync(join(root, ".release"), { recursive: true });
  writeFileSync(join(root, ".release/source-attestation-error.json"), JSON.stringify({ version: BUILD_ATTESTATION_VERSION, code }));
}

export function attestRailpackBuild({ root = process.cwd(), env = process.env } = {}) {
  const manifest = parseImmutablePublicationManifest(env.APP_IMMUTABLE_SOURCE_MANIFEST);
  let lockfile;
  try { lockfile = readFileSync(join(root, "package-lock.json")); } catch { throw new Error("LOCKFILE_MISSING"); }
  const lockfileHash = digest(lockfile);
  const buildContextDigest = computeBuildContextDigest(root);
  if (lockfileHash !== manifest.lockfileHash) throw new Error("LOCKFILE_MISMATCH");
  if (buildContextDigest !== manifest.buildContextDigest) throw new Error("BUILD_CONTEXT_DIGEST_MISMATCH");
  for (const [key, expected] of [["APP_RELEASE_SHA", manifest.commitSha], ["APP_RELEASE_TREE", manifest.tree], ["APP_RELEASE_SOURCE_DIGEST", manifest.sourceDigest]]) {
    if (env[key]?.trim() !== expected) throw new Error(`${key}_MISMATCH`);
  }
  if (env.RAILWAY_GIT_COMMIT_SHA && env.RAILWAY_GIT_COMMIT_SHA.trim() !== manifest.commitSha) throw new Error("RAILWAY_COMMIT_MISMATCH");
  return { mode: "RAILPACK_BUILD", ...manifest, platformCommitStatus: env.RAILWAY_GIT_COMMIT_SHA ? "PRESENT" : "EXTERNAL_DEPLOYMENT_METADATA_REQUIRED" };
}

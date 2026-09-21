import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseRuntimeEnvironment } from "../src/lib/release/environment-contract.mjs";
import { attestRailpackBuild, writeAttestationError } from "../src/lib/release/build-attestation.mjs";

const root = process.cwd();
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const write = (value) => { mkdirSync(join(root, ".release"), { recursive: true }); writeFileSync(join(root, ".release/source-attestation.json"), JSON.stringify(value)); };
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const identifiedDeployment = process.env.APP_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_DEPLOYMENT_ID;
let runtimeEnvironment;
try { runtimeEnvironment = parseRuntimeEnvironment(process.env); }
catch {
  writeAttestationError(root, "UNKNOWN_ENVIRONMENT");
  write({ mode: "INVALID", version: 1, errorCode: "UNKNOWN_ENVIRONMENT" });
  console.error("RELEASE_SOURCE_ATTESTATION_FAILED:UNKNOWN_ENVIRONMENT");
  process.exit(1);
}

if (!identifiedDeployment || runtimeEnvironment !== "production") {
  write({ mode: "LOCAL_UNATTESTED" });
  process.exit(0);
}

function gitMetadataAvailable() {
  if (!existsSync(join(root, ".git"))) return false;
  try { return git("rev-parse", "--is-inside-work-tree").toString().trim() === "true"; }
  catch (error) {
    const message = String(error?.message ?? "");
    if (/ENOENT|not found/i.test(message)) throw new Error("GIT_UNAVAILABLE");
    throw new Error("GIT_METADATA_MISSING");
  }
}

try {
  const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME?.trim();
  if (process.env.APP_DEPLOYMENT_PROFILE === "rc-staging" && environmentName !== "Production-RC-Staging-20260920") throw new Error(environmentName ? "UNKNOWN_ENVIRONMENT" : "RAILWAY_ENVIRONMENT_IDENTITY_MISSING");
  if ((process.env.APP_DEPLOYMENT_PROFILE || "production") === "production" && environmentName && environmentName !== "production") throw new Error("UNKNOWN_ENVIRONMENT");
  const stagingBuildContext = process.env.APP_DEPLOYMENT_PROFILE === "rc-staging" && !gitMetadataAvailable();
  if (stagingBuildContext) {
    const proof = attestRailpackBuild({ root, env: process.env });
    write(proof);
    console.log("RELEASE_SOURCE_ATTESTED");
    process.exit(0);
  }
  if (process.env.APP_DEPLOYMENT_PROFILE === "rc-staging" && !existsSync(join(root, ".git"))) throw new Error("GIT_METADATA_MISSING");
  if (git("status", "--porcelain", "--untracked-files=all").toString().trim()) throw new Error("LOCAL_DIRTY");
  const commitSha = git("rev-parse", "HEAD").toString().trim();
  if (process.env.RAILWAY_GIT_COMMIT_SHA && process.env.RAILWAY_GIT_COMMIT_SHA !== commitSha) throw new Error("RAILWAY_COMMIT_MISMATCH");
  const proof = { version: 1, mode: "LOCAL_PUBLICATION", commitSha, tree: git("rev-parse", "HEAD^{tree}").toString().trim(), sourceDigest: sha256(git("archive", "--format=tar", "HEAD")), lockfileHash: sha256(readFileSync(join(root, "package-lock.json"))) };
  write(proof);
  console.log("RELEASE_SOURCE_ATTESTED");
} catch (error) {
  const code = String(error?.message ?? "SOURCE_ATTESTATION_FAILED").split("\n")[0].slice(0, 120);
  write({ mode: "INVALID", version: 1, errorCode: code });
  writeAttestationError(root, code);
  console.error(`RELEASE_SOURCE_ATTESTATION_FAILED:${code}`);
  process.exitCode = 1;
}

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseRuntimeEnvironment } from "../src/lib/release/environment-contract.mjs";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
mkdirSync(".release", { recursive: true });
const identifiedDeployment = process.env.APP_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_DEPLOYMENT_ID;
if (!identifiedDeployment || parseRuntimeEnvironment(process.env) !== "production") {
  // A dirty local verification build must never masquerade as a release artifact.
  writeFileSync(".release/source-attestation.json", JSON.stringify({ mode: "LOCAL_UNATTESTED" }));
} else {
  try {
    if (git("status", "--porcelain", "--untracked-files=all").toString().trim()) throw new Error("DIRTY_SOURCE");
    const commitSha = git("rev-parse", "HEAD").toString().trim();
    if (process.env.RAILWAY_GIT_COMMIT_SHA && process.env.RAILWAY_GIT_COMMIT_SHA !== commitSha) throw new Error("SOURCE_MISMATCH");
    const proof = { commitSha, tree: git("rev-parse", "HEAD^{tree}").toString().trim(), sourceDigest: sha256(git("archive", "--format=tar", "HEAD")), lockfileHash: sha256(readFileSync("package-lock.json")) };
    writeFileSync(".release/source-attestation.json", JSON.stringify(proof));
    console.log("RELEASE_SOURCE_ATTESTED");
  } catch {
    writeFileSync(".release/source-attestation.json", JSON.stringify({ mode: "INVALID" }));
    console.error("RELEASE_SOURCE_ATTESTATION_FAILED"); process.exitCode = 1;
  }
}

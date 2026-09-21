import { readFileSync } from "node:fs";
import { parseImmutablePublicationManifest } from "../src/lib/release/build-attestation.mjs";

export function verifyDeploymentAttestation({ metadata, manifestRaw }) {
  const manifest = parseImmutablePublicationManifest(manifestRaw);
  const sourceCommit = metadata?.commitHash ?? metadata?.commitSha ?? metadata?.sourceCommit ?? metadata?.meta?.commitHash ?? metadata?.meta?.commitSha;
  if (typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/i.test(sourceCommit)) throw new Error("RAILWAY_COMMIT_METADATA_MISSING");
  if (sourceCommit.toLowerCase() !== manifest.commitSha) throw new Error("RAILWAY_COMMIT_MISMATCH");
  return { verified: true, commitSha: manifest.commitSha, tree: manifest.tree, sourceDigest: manifest.sourceDigest, lockfileHash: manifest.lockfileHash, buildContextDigest: manifest.buildContextDigest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const metadataPath = process.argv[2];
    const metadata = metadataPath ? JSON.parse(readFileSync(metadataPath, "utf8")) : null;
    const proof = verifyDeploymentAttestation({ metadata, manifestRaw: process.env.APP_IMMUTABLE_SOURCE_MANIFEST });
    console.log(JSON.stringify(proof));
  } catch (error) {
    console.error(`RC_STAGING_DEPLOYMENT_ATTESTATION_FAILED:${String(error?.message ?? "UNKNOWN")}`);
    process.exitCode = 1;
  }
}

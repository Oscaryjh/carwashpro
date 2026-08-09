import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  STATUTORY_ARTIFACT_ERRORS,
  verifyArtifactBytes,
  type OfficialArtifactManifest,
} from "../src/lib/payroll/statutory-artifact-pipeline";

async function main() {
const manifestPath = resolve("statutory/official/manifest.json");
const manifest: OfficialArtifactManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requestedIds = process.argv
  .filter((argument) => argument.startsWith("--artifact="))
  .map((argument) => argument.slice("--artifact=".length));
const localPaths = new Map(
  process.argv
    .filter((argument) => argument.startsWith("--path="))
    .map((argument) => argument.slice("--path=".length).split("=", 2) as [string, string]),
);
const allowUnavailable = process.argv.includes("--allow-unavailable");
const artifacts = manifest.artifacts.filter(
  (artifact) => requestedIds.length === 0 || requestedIds.includes(artifact.id),
);

if (artifacts.length === 0) {
  throw new Error("No statutory artifacts matched the requested IDs.");
}

let failures = 0;
for (const artifact of artifacts) {
  try {
    let bytes: Uint8Array;
    let contentType: string | null;
    const localPath = localPaths.get(artifact.id);
    if (localPath) {
      bytes = await readFile(resolve(localPath));
      contentType = artifact.mimeType;
    } else {
      const response = await fetch(artifact.sourceUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
        headers: { "user-agent": "Tetamu-Statutory-Artifact-Verifier/1.0" },
      });
      contentType = response.headers.get("content-type");
      bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || (artifact.artifactType === "PDF" && !contentType?.includes("application/pdf"))) {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.SOURCE_DRIFT);
      }
    }
    const result = verifyArtifactBytes(artifact, bytes, contentType);
    if (!result.ok) throw new Error(result.code);
    console.log(`VERIFIED ${artifact.id} ${artifact.sha256} ${bytes.byteLength} bytes`);
  } catch (error) {
    failures += 1;
    console.error(
      `FAILED ${artifact.id} ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (failures > 0 && !allowUnavailable) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

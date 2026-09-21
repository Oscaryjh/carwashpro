import type { ImmutablePublicationManifest } from "../src/lib/release/build-attestation.mjs";
export function verifyDeploymentAttestation(args: { metadata: unknown; manifestRaw: string | undefined }): { verified: true } & ImmutablePublicationManifest;

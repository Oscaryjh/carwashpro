export type ImmutablePublicationManifest = {
  version: 1;
  commitSha: string;
  tree: string;
  sourceDigest: string;
  lockfileHash: string;
  buildContextDigest: string;
};
export const BUILD_ATTESTATION_VERSION: 1;
export function computeBuildContextDigest(root?: string): string;
export function parseImmutablePublicationManifest(raw: string | undefined): ImmutablePublicationManifest;
export function writeAttestationError(root: string, code: string): void;
export function attestRailpackBuild(args?: { root?: string; env?: Readonly<Record<string, string | undefined>> }): ImmutablePublicationManifest & { mode: "RAILPACK_BUILD"; platformCommitStatus: string };

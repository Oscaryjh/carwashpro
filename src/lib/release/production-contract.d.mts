export type SourceAttestation = { version?: number; mode?: string; commitSha: string; tree: string; sourceDigest: string; lockfileHash: string; buildContextDigest?: string };
export function validateProductionRuntime(env: Readonly<Record<string, string | undefined>>, scope: string, attestation: SourceAttestation | null): Pick<SourceAttestation, "commitSha" | "tree" | "sourceDigest">;
export function databaseIdentityFingerprint(env: Readonly<Record<string, string | undefined>>): string;

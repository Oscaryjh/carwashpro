// This installer is intentionally not a general-purpose seed command.
// Only independently obtained platform metadata may be passed by its connector.
export const STAGING_FIXTURE_TARGET = Object.freeze({
  appEnvironment: "production", nodeEnvironment: "production", profile: "rc-staging",
  projectId: "ec8b25a7-4fb9-4959-8353-b4af000f4e80",
  environmentId: "f7702966-0249-4df3-bca3-186e4b4af726", environmentName: "Production-RC-Staging-20260920",
  serviceId: "4dcd57a4-fc65-4cf8-97f7-39d1d89f6bb9",
  databaseServiceId: "a6b0c406-3410-46a5-b53d-08b4bf340be9",
  volumeId: "ff14274e-4404-4602-aef6-151e617f2dfb",
  region: "asia-southeast1-eqsg3a", volumeRegion: "asia-southeast1-eqsg3a",
  databaseFingerprint: "53db29e798907e78e1dadc78fa126070a29207359b2ce349eddb024bc4987b5b",
  inventoryDigest: "37bcd028088fa7c513b5cd827f11a885e5de340c5310755e441cd5eda88afad2",
  inventoryComplete: true, protectedCollision: false, metadataComplete: true,
});

export function assertStagingFixtureIdentity(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.entries(STAGING_FIXTURE_TARGET).some(([key, value]) => (input as Record<string, unknown>)[key] !== value)) {
    throw new Error("RC_STAGING_FIXTURE_IDENTITY_REJECTED");
  }
}

export function assertStagingFixtureState(input: {
  rows: number; marker: unknown; expectedVersion: string; expectedDefinitionDigest: string; currentDigest: string;
}): "INSTALL" | "VERIFY_ONLY" {
  const validDigest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!Number.isSafeInteger(input.rows) || input.rows < 0 || !input.expectedVersion ||
    !validDigest(input.expectedDefinitionDigest) || !validDigest(input.currentDigest)) throw new Error("RC_STAGING_FIXTURE_STATE_REJECTED");
  if (input.rows === 0 && input.marker === null) return "INSTALL";
  const marker = input.marker as Record<string, unknown> | null;
  if (!marker || marker.status !== "COMPLETE" || marker.version !== input.expectedVersion ||
    marker.definitionDigest !== input.expectedDefinitionDigest || marker.dataDigest !== input.currentDigest) {
    throw new Error("RC_STAGING_FIXTURE_STATE_REJECTED");
  }
  return "VERIFY_ONLY";
}

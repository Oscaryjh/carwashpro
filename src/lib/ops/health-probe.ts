export function evaluateReleaseHealth(payload: unknown, expected: { commitSha: string; tree: string; sourceDigest: string }) {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  const release = value.release as Record<string, unknown> | null;
  return value.ok === true && value.database === "ready" && release?.environment === "production" &&
    release.commitSha === expected.commitSha && release.tree === expected.tree && release.sourceDigest === expected.sourceDigest;
}

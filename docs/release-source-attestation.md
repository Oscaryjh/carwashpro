# Release source attestation

Source publication and Railpack build attestation are separate gates.

- Local publication requires a clean Git worktree and records commit, tree, Git archive digest, and lockfile hash.
- An RC Staging Railpack context may not contain `.git`; it must receive a validated immutable publication manifest and compute a deterministic build-context digest over the build files.
- The build writes `.release/source-attestation.json` and fails closed for missing, malformed, tampered, or mismatched values. A sanitized `.release/source-attestation-error.json` classifies failures such as `GIT_METADATA_MISSING`, `LOCAL_DIRTY`, `LOCKFILE_MISMATCH`, `BUILD_CONTEXT_DIGEST_MISMATCH`, and `RAILWAY_COMMIT_MISMATCH`.
- Runtime compares the embedded attestation with the immutable publication manifest and protected Staging identity. The external deployment verifier separately checks Railway deployment metadata; an application self-reported release variable is never sufficient proof.

The immutable manifest is configuration supplied from the verified publication step. It contains only non-secret digests and is never used as a replacement for the protected Railway identity checks.

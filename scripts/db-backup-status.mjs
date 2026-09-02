import {
  assertSupportedEnvironment,
  createS3ClientFromEnvironment,
  listHealthyManifests,
  readJsonObject,
} from "./lib/database-backup-core.mjs";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

const environment = assertSupportedEnvironment(process.env.BACKUP_ENVIRONMENT);
const bucket = required("BACKUP_S3_BUCKET");
const prefix = required("BACKUP_S3_PREFIX").replace(/\/+$/g, "");
const client = createS3ClientFromEnvironment();
const manifests = await listHealthyManifests({ client, bucket, prefix, environment });
const latest = manifests.sort(
  (a, b) => new Date(b.manifest.createdAt).valueOf() - new Date(a.manifest.createdAt).valueOf(),
)[0];
const verificationList = await client.send(
  new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${prefix}/restore-verifications/`,
  }),
);
const latestVerificationKey = (verificationList.Contents ?? [])
  .map((item) => item.Key)
  .filter(Boolean)
  .sort()
  .at(-1);
const verification = latestVerificationKey
  ? await readJsonObject({ client, bucket, key: latestVerificationKey })
  : null;

console.log(
  JSON.stringify({
    environment,
    healthyBackupCount: manifests.length,
    latestBackup: latest
      ? {
          createdAt: latest.manifest.createdAt,
          mode: latest.manifest.mode,
          archiveBytes: latest.manifest.encrypted.bytes,
          archiveSha256: latest.manifest.encrypted.sha256,
          catalogEntries: latest.manifest.source.catalogEntries,
          manifestKey: latest.manifestKey,
          protected: latest.manifest.protected,
        }
      : null,
    latestRestoreVerification: verification
      ? {
          timestamp: verification.timestamp,
          status: verification.status,
          resultKey: latestVerificationKey,
          details: verification.details,
        }
      : null,
  }),
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Off-site storage for backups: any S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3).
// BACKUP_S3_ENDPOINT (R2/B2 endpoint; empty for AWS), BACKUP_S3_REGION ("auto" for R2), BACKUP_S3_BUCKET,
// BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_PREFIX (default "pos-backups/").

export const storageSettings = (config = process.env) => ({
  endpoint: config.BACKUP_S3_ENDPOINT || undefined,
  region: config.BACKUP_S3_REGION || "auto",
  bucket: config.BACKUP_S3_BUCKET || "",
  accessKeyId: config.BACKUP_S3_ACCESS_KEY_ID || "",
  secretAccessKey: config.BACKUP_S3_SECRET_ACCESS_KEY || "",
  prefix: (config.BACKUP_S3_PREFIX || "pos-backups/").replace(/^\/+/, ""),
});

/** What is missing before backups can run (empty list = ready). Never includes secret values. */
export const missingBackupSettings = (config = process.env) => {
  const settings = storageSettings(config);
  return [
    !settings.bucket && "BACKUP_S3_BUCKET",
    !settings.accessKeyId && "BACKUP_S3_ACCESS_KEY_ID",
    !settings.secretAccessKey && "BACKUP_S3_SECRET_ACCESS_KEY",
    (!config.BACKUP_ENCRYPTION_KEY || config.BACKUP_ENCRYPTION_KEY.length < 32) && "BACKUP_ENCRYPTION_KEY (32+ characters)",
  ].filter(Boolean);
};

/** Where backups go, for status screens (host and bucket only). */
export const storageLabel = (config = process.env) => {
  const settings = storageSettings(config);
  let host = "AWS S3";
  try { if (settings.endpoint) host = new URL(settings.endpoint).hostname; } catch { host = "custom storage"; }
  return `${host} / ${settings.bucket}`;
};

export function createBackupStorage(config = process.env) {
  const settings = storageSettings(config);
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: Boolean(settings.endpoint),
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // R2 and B2 do not accept the newer streaming checksum trailers; send plain requests.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const key = (name) => `${settings.prefix}${name}`;
  return {
    prefix: settings.prefix,
    async upload(name, filePath, metadata = {}) {
      const { size } = await fs.stat(filePath);
      await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key(name), Body: createReadStream(filePath), ContentLength: size, ContentType: "application/octet-stream", Metadata: metadata }));
      return { key: key(name), bytes: size };
    },
    async download(name, filePath) {
      const response = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key(name) }));
      await pipeline(response.Body, createWriteStream(filePath, { mode: 0o600 }));
      return filePath;
    },
    async list() {
      const items = [];
      let token;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: settings.prefix, ContinuationToken: token }));
        for (const item of page.Contents || []) items.push({ name: item.Key.slice(settings.prefix.length), bytes: item.Size, modified: item.LastModified });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return items;
    },
    async remove(name) { await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key(name) })); },
  };
}

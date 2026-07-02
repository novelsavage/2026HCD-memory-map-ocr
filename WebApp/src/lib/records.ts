import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type CaptureStatus = "captured" | "pending_review" | "published";
export type OcrStatus = "not_run" | "running" | "succeeded" | "failed";
export type PublishStatus = "not_sent" | "sending" | "sent" | "failed";
export type Campus = "inside" | "outside" | "unknown";

export type CaptureRecord = {
  id: string;
  eventId: string;
  status: CaptureStatus;
  version: number;
  updatedAt: string;
  lockedBy?: string | null;
  lockedAt?: string | null;
  operator: {
    name: string;
    location: string;
    deviceLabel: string;
  };
  memory: {
    nickname: string;
    genre: string;
    mapArea: string;
    note: string;
    era: string;
    latitude: string;
    longitude: string;
    campus: Campus;
  };
  capture: {
    originalName: string;
    storedFileName: string;
    localImagePath: string;
    receivedAt: string;
    size: number;
    mimeType: string;
    crop?: {
      originalName: string;
      storedFileName: string;
      localImagePath: string;
      size: number;
      mimeType: string;
      aspectRatio: "5:3";
      sourceRect?: CropRect;
      guideRect?: CropRect;
    };
  };
  sync: {
    labPcSent: boolean;
    cloudUploaded: boolean;
    lastError: string | null;
  };
  ocr: {
    engine: "yomitoku";
    status: OcrStatus;
    textRaw: string;
    textReviewed: string;
    ranAt: string | null;
    inputImagePath: string | null;
    overlayImagePath: string | null;
    lastError: string | null;
  };
  review: {
    reviewedAt: string | null;
    reviewedBy: string;
    note: string;
    excludeFromPublish: boolean;
  };
  publish: {
    status: PublishStatus;
    sentAt: string | null;
    bucket: string;
    prefix: string;
    originalKey: string | null;
    cropKey: string | null;
    recordKey: string | null;
    manifestKey: string | null;
    publicImageUrl: string | null;
    cardKey: string | null;
    cardFileName: string | null;
    generatedCardPath: string | null;
    cardGeneratedAt: string | null;
    cardSourceVersion: number | null;
    lastError: string | null;
    supabaseSynced: boolean;
    supabaseSyncedAt: string | null;
    supabaseError: string | null;
  };
};

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const EVENT_ID = process.env.HCD_EVENT_ID || "reitaku-hcd-2026";
const OUTPUT_ROOT = path.resolve(
  process.cwd(),
  "..",
  "outputs",
  "webapp-captures",
  EVENT_ID
);

export function getOutputRoot() {
  return OUTPUT_ROOT;
}

export function getPublicImagePath(fileName: string) {
  return `/api/captures/${encodeURIComponent(fileName)}`;
}

export async function ensureCaptureDirs() {
  await mkdir(path.join(OUTPUT_ROOT, "captures"), { recursive: true });
  await mkdir(path.join(OUTPUT_ROOT, "records"), { recursive: true });
}

export function createCaptureId() {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `HCD-${stamp}-${suffix}`;
}

export async function saveCaptureRecord(
  record: CaptureRecord,
  image: Buffer,
  cropImage?: Buffer
) {
  await ensureCaptureDirs();
  const normalizedRecord = normalizeCaptureRecord(record);
  const imagePath = path.join(OUTPUT_ROOT, "captures", record.capture.storedFileName);
  const recordPath = path.join(OUTPUT_ROOT, "records", `${record.id}.json`);

  await writeFile(imagePath, image);
  if (cropImage && record.capture.crop) {
    await writeFile(
      path.join(OUTPUT_ROOT, "captures", record.capture.crop.storedFileName),
      cropImage
    );
  }
  await writeFile(recordPath, JSON.stringify(normalizedRecord, null, 2), "utf-8");
  await rebuildManifest();
}

export async function listCaptureRecords() {
  await ensureCaptureDirs();
  const recordsDir = path.join(OUTPUT_ROOT, "records");
  const names = await readdir(recordsDir);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const raw = await readFile(path.join(recordsDir, name), "utf-8");
        return normalizeCaptureRecord(JSON.parse(raw));
      })
  );

  return records.sort((a, b) =>
    b.capture.receivedAt.localeCompare(a.capture.receivedAt)
  );
}

export async function getCaptureRecord(id: string) {
  if (!isSafeRecordId(id)) return null;
  await ensureCaptureDirs();
  try {
    const raw = await readFile(recordFilePath(id), "utf-8");
    return normalizeCaptureRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCaptureRecord(record: CaptureRecord) {
  await ensureCaptureDirs();
  const normalizedRecord = normalizeCaptureRecord(record);
  await writeFile(
    recordFilePath(normalizedRecord.id),
    JSON.stringify(normalizedRecord, null, 2),
    "utf-8"
  );
  await rebuildManifest();
  return normalizedRecord;
}

export async function updateCaptureRecord(
  id: string,
  update: (record: CaptureRecord) => CaptureRecord
) {
  const record = await getCaptureRecord(id);
  if (!record) return null;
  const now = new Date().toISOString();
  const next = normalizeCaptureRecord({
    ...update(record),
    version: record.version + 1,
    updatedAt: now
  });
  await writeCaptureRecord(next);
  return next;
}

export async function rebuildManifest() {
  const records = await listCaptureRecords();
  const manifest = {
    eventId: EVENT_ID,
    generatedAt: new Date().toISOString(),
    count: records.length,
    records
  };
  await writeFile(
    path.join(OUTPUT_ROOT, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  return manifest;
}

export function normalizeCaptureRecord(input: unknown): CaptureRecord {
  const record = (input ?? {}) as Partial<CaptureRecord> & {
    status?: CaptureStatus | "upload_failed";
  };
  const receivedAt = record.capture?.receivedAt || new Date().toISOString();
  const sync = record.sync ?? {
    labPcSent: false,
    cloudUploaded: false,
    lastError: null
  };
  const rawStatus = String(record.status ?? "");
  const status: CaptureStatus =
    rawStatus === "pending_review"
      ? "pending_review"
      : rawStatus === "published"
        ? "published"
        : "captured";
  const uploadError =
    rawStatus === "upload_failed" && !sync.lastError
      ? "upload_failed"
      : sync.lastError;

  return {
    id: String(record.id ?? ""),
    eventId: String(record.eventId ?? EVENT_ID),
    status,
    version: typeof record.version === "number" ? record.version : 1,
    updatedAt: String(record.updatedAt ?? receivedAt),
    lockedBy: record.lockedBy ?? null,
    lockedAt: record.lockedAt ?? null,
    operator: {
      name: String(record.operator?.name ?? ""),
      location: String(record.operator?.location ?? ""),
      deviceLabel: String(record.operator?.deviceLabel ?? "")
    },
    memory: {
      nickname: String(record.memory?.nickname ?? ""),
      genre: String(record.memory?.genre || "unknown"),
      mapArea: String(record.memory?.mapArea ?? ""),
      note: String(record.memory?.note ?? ""),
      era: String(record.memory?.era ?? ""),
      latitude: String(record.memory?.latitude ?? ""),
      longitude: String(record.memory?.longitude ?? ""),
      campus: normalizeCampus(record.memory?.campus)
    },
    capture: {
      originalName: String(record.capture?.originalName ?? ""),
      storedFileName: String(record.capture?.storedFileName ?? ""),
      localImagePath: String(record.capture?.localImagePath ?? ""),
      receivedAt,
      size: Number(record.capture?.size ?? 0),
      mimeType: String(record.capture?.mimeType ?? "application/octet-stream"),
      ...(record.capture?.crop
        ? {
            crop: {
              originalName: String(record.capture.crop.originalName ?? ""),
              storedFileName: String(record.capture.crop.storedFileName ?? ""),
              localImagePath: String(record.capture.crop.localImagePath ?? ""),
              size: Number(record.capture.crop.size ?? 0),
              mimeType: String(
                record.capture.crop.mimeType ?? "application/octet-stream"
              ),
              aspectRatio: "5:3" as const,
              sourceRect: record.capture.crop.sourceRect,
              guideRect: record.capture.crop.guideRect
            }
          }
        : {})
    },
    sync: {
      labPcSent: Boolean(sync.labPcSent),
      cloudUploaded: Boolean(sync.cloudUploaded),
      lastError: uploadError ?? null
    },
    ocr: {
      engine: "yomitoku",
      status: normalizeOcrStatus(record.ocr?.status),
      textRaw: String(record.ocr?.textRaw ?? ""),
      textReviewed: String(record.ocr?.textReviewed ?? record.memory?.note ?? ""),
      ranAt: record.ocr?.ranAt ?? null,
      inputImagePath: record.ocr?.inputImagePath ?? null,
      overlayImagePath: record.ocr?.overlayImagePath ?? null,
      lastError: record.ocr?.lastError ?? null
    },
    review: {
      reviewedAt: record.review?.reviewedAt ?? null,
      reviewedBy: String(record.review?.reviewedBy ?? ""),
      note: String(record.review?.note ?? ""),
      excludeFromPublish: Boolean(record.review?.excludeFromPublish)
    },
    publish: {
      status: normalizePublishStatus(record.publish?.status),
      sentAt: record.publish?.sentAt ?? null,
      bucket: String(record.publish?.bucket ?? ""),
      prefix: String(record.publish?.prefix ?? ""),
      originalKey: record.publish?.originalKey ?? null,
      cropKey: record.publish?.cropKey ?? null,
      recordKey: record.publish?.recordKey ?? null,
      manifestKey: record.publish?.manifestKey ?? null,
      publicImageUrl: record.publish?.publicImageUrl ?? null,
      cardKey: record.publish?.cardKey ?? null,
      cardFileName: record.publish?.cardFileName ?? null,
      generatedCardPath: record.publish?.generatedCardPath ?? null,
      cardGeneratedAt: record.publish?.cardGeneratedAt ?? null,
      cardSourceVersion:
        typeof record.publish?.cardSourceVersion === "number"
          ? record.publish.cardSourceVersion
          : null,
      lastError: record.publish?.lastError ?? null,
      supabaseSynced: Boolean(record.publish?.supabaseSynced),
      supabaseSyncedAt: record.publish?.supabaseSyncedAt ?? null,
      supabaseError: record.publish?.supabaseError ?? null
    }
  };
}

export function isSafeRecordId(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function recordFilePath(id: string) {
  return path.join(OUTPUT_ROOT, "records", `${id}.json`);
}

function normalizeOcrStatus(status: unknown): OcrStatus {
  return status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "not_run"
    ? status
    : "not_run";
}

function normalizeCampus(campus: unknown): Campus {
  return campus === "inside" || campus === "outside" ? campus : "unknown";
}

function normalizePublishStatus(status: unknown): PublishStatus {
  return status === "sending" ||
    status === "sent" ||
    status === "failed" ||
    status === "not_sent"
    ? status
    : "not_sent";
}

import path from "node:path";
import { NextResponse } from "next/server";
import {
  createCaptureId,
  saveCaptureRecord,
  type Campus,
  type CaptureRecord
} from "@/lib/records";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("image");
  const cropFile = formData.get("cropImage");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  const id = createCaptureId();
  const ext = extensionFor(file.name, file.type);
  const storedFileName = `${id}${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const crop =
    cropFile instanceof File
      ? {
          file: cropFile,
          ext: extensionFor(cropFile.name, cropFile.type),
          bytes: Buffer.from(await cropFile.arrayBuffer())
        }
      : null;
  const cropStoredFileName = crop ? `${id}-crop${crop.ext}` : "";
  const receivedAt = new Date().toISOString();

  const record: CaptureRecord = {
    id,
    eventId: process.env.HCD_EVENT_ID || "reitaku-hcd-2026",
    status: "captured",
    version: 1,
    updatedAt: receivedAt,
    lockedBy: null,
    lockedAt: null,
    operator: {
      name: textField(formData, "operatorName"),
      location: textField(formData, "location"),
      deviceLabel: textField(formData, "deviceLabel")
    },
    memory: {
      nickname: textField(formData, "nickname"),
      genre: textField(formData, "genre") || "unknown",
      mapArea: textField(formData, "mapArea"),
      note: textField(formData, "note"),
      era: textField(formData, "era"),
      latitude: textField(formData, "latitude"),
      longitude: textField(formData, "longitude"),
      campus: campusField(formData, "campus")
    },
    capture: {
      originalName: file.name,
      storedFileName,
      localImagePath: path.join("captures", storedFileName),
      receivedAt,
      size: bytes.length,
      mimeType: file.type || "application/octet-stream",
      ...(crop
        ? {
            crop: {
              originalName: crop.file.name,
              storedFileName: cropStoredFileName,
              localImagePath: path.join("captures", cropStoredFileName),
              size: crop.bytes.length,
              mimeType: crop.file.type || "application/octet-stream",
              aspectRatio: "5:3" as const,
              sourceRect: rectField(formData, "cropSourceRect"),
              guideRect: rectField(formData, "cropGuideRect")
            }
          }
        : {})
    },
    sync: {
      labPcSent: false,
      cloudUploaded: false,
      lastError: null
    },
    ocr: {
      engine: "yomitoku",
      status: "not_run",
      textRaw: "",
      textReviewed: "",
      ranAt: null,
      inputImagePath: null,
      overlayImagePath: null,
      lastError: null
    },
    review: {
      reviewedAt: null,
      reviewedBy: "",
      note: "",
      excludeFromPublish: false
    },
    publish: {
      status: "not_sent",
      sentAt: null,
      bucket: "",
      prefix: "",
      originalKey: null,
      cropKey: null,
      recordKey: null,
      manifestKey: null,
      publicImageUrl: null,
      cardKey: null,
      cardFileName: null,
      generatedCardPath: null,
      cardGeneratedAt: null,
      cardSourceVersion: null,
      lastError: null,
      supabaseSynced: false,
      supabaseSyncedAt: null,
      supabaseError: null
    }
  };

  await saveCaptureRecord(record, bytes, crop?.bytes);

  return NextResponse.json({ ok: true, record });
}

function textField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function campusField(formData: FormData, key: string): Campus {
  const value = formData.get(key);
  return value === "inside" || value === "outside" ? value : "unknown";
}

function rectField(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const x = numberField(parsed.x);
    const y = numberField(parsed.y);
    const width = numberField(parsed.width);
    const height = numberField(parsed.height);
    if (x === null || y === null || width === null || height === null) {
      return undefined;
    }
    return { x, y, width, height };
  } catch {
    return undefined;
  }
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null;
}

function extensionFor(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    return ext === ".jpeg" ? ".jpg" : ext;
  }
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

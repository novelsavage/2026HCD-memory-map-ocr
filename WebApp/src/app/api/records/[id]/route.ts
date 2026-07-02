import { NextResponse } from "next/server";
import {
  getCaptureRecord,
  isSafeRecordId,
  updateCaptureRecord,
  type Campus
} from "@/lib/records";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isSafeRecordId(id)) {
    return NextResponse.json({ error: "invalid record id" }, { status: 400 });
  }

  const record = await getCaptureRecord(id);
  if (!record) {
    return NextResponse.json({ error: "record not found" }, { status: 404 });
  }

  return NextResponse.json({ record });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isSafeRecordId(id)) {
    return NextResponse.json({ error: "invalid record id" }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const current = await getCaptureRecord(id);
  if (!current) {
    return NextResponse.json({ error: "record not found" }, { status: 404 });
  }

  const payloadVersion = numberValue((payload as { version?: unknown }).version);
  if (payloadVersion !== null && payloadVersion !== current.version) {
    return NextResponse.json(
      {
        ok: false,
        error: "record_conflict",
        message: "この付箋は他のユーザーにより更新されています。",
        record: current
      },
      { status: 409 }
    );
  }

  const next = await updateCaptureRecord(id, (record) => {
    const memory = objectValue((payload as { memory?: unknown }).memory);
    const ocr = objectValue((payload as { ocr?: unknown }).ocr);
    const review = objectValue((payload as { review?: unknown }).review);
    const lock = objectValue((payload as { lock?: unknown }).lock);

    return {
      ...record,
      memory: {
        ...record.memory,
        nickname: stringValue(memory.nickname, record.memory.nickname),
        genre: stringValue(memory.genre, record.memory.genre || "unknown"),
        era: stringValue(memory.era, record.memory.era),
        latitude: stringValue(memory.latitude, record.memory.latitude),
        longitude: stringValue(memory.longitude, record.memory.longitude),
        campus: campusValue(memory.campus, record.memory.campus)
      },
      ocr: {
        ...record.ocr,
        textReviewed: stringValue(ocr.textReviewed, record.ocr.textReviewed)
      },
      review: {
        ...record.review,
        note: stringValue(review.note, record.review.note),
        excludeFromPublish: booleanValue(
          review.excludeFromPublish,
          record.review.excludeFromPublish
        )
      },
      publish:
        record.status === "published"
          ? {
              ...record.publish,
              status: "not_sent",
              sentAt: null,
              publicImageUrl: null,
              cardKey: null,
              cardFileName: null,
              generatedCardPath: null,
              cardGeneratedAt: null,
              cardSourceVersion: null,
              lastError: null
            }
          : record.publish,
      lockedBy:
        typeof lock.lockedBy === "string" ? lock.lockedBy.trim() || null : record.lockedBy,
      lockedAt:
        typeof lock.lockedAt === "string" ? lock.lockedAt.trim() || null : record.lockedAt
    };
  });

  return NextResponse.json({ ok: true, record: next });
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function campusValue(value: unknown, fallback: Campus): Campus {
  return value === "inside" || value === "outside" || value === "unknown"
    ? value
    : fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

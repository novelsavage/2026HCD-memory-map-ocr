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

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isSafeRecordId(id)) {
    return NextResponse.json({ error: "invalid record id" }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const action = (payload as { action?: unknown }).action;
  if (action !== "approve-and-publish" && action !== "republish") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
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

  if (action === "republish") {
    const next = await updateCaptureRecord(id, (record) => ({
      ...record,
      publish: {
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
    }));
    return NextResponse.json({ ok: true, record: next });
  }

  if (current.status !== "pending_review") {
    return NextResponse.json(
      {
        ok: false,
        error: "not_review_ready",
        message: "レビュー待ちの付箋だけ承認できます。",
        record: current
      },
      { status: 400 }
    );
  }

  const memory = objectValue((payload as { memory?: unknown }).memory);
  const ocr = objectValue((payload as { ocr?: unknown }).ocr);
  const review = objectValue((payload as { review?: unknown }).review);
  const reviewerName = stringValue(
    (payload as { reviewerName?: unknown }).reviewerName,
    current.review.reviewedBy
  );
  const reviewedText = stringValue(ocr.textReviewed, current.ocr.textReviewed).trim();
  const campus = campusValue(memory.campus, current.memory.campus);

  if (!reviewedText) {
    return NextResponse.json(
      { ok: false, error: "review_text_required", message: "レビュー後本文が必要です。" },
      { status: 400 }
    );
  }

  if (campus === "unknown") {
    return NextResponse.json(
      {
        ok: false,
        error: "campus_required",
        message: "大学内/外を判定してください。",
        record: current
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const next = await updateCaptureRecord(id, (record) => ({
    ...record,
    status: "published",
    memory: {
      ...record.memory,
      nickname: stringValue(memory.nickname, record.memory.nickname),
      genre: stringValue(memory.genre, record.memory.genre || "unknown"),
      era: stringValue(memory.era, record.memory.era),
      latitude: stringValue(memory.latitude, record.memory.latitude),
      longitude: stringValue(memory.longitude, record.memory.longitude),
      campus
    },
    ocr: {
      ...record.ocr,
      textReviewed: reviewedText
    },
    review: {
      ...record.review,
      reviewedAt: now,
      reviewedBy: reviewerName,
      note: stringValue(review.note, record.review.note),
      excludeFromPublish: booleanValue(
        review.excludeFromPublish,
        record.review.excludeFromPublish
      )
    },
    publish: {
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
    },
    lockedBy: null,
    lockedAt: null
  }));

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

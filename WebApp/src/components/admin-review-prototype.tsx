"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CaptureRecord } from "@/lib/records";

type ReviewStage = "captured" | "pending_review" | "published";
type OcrStatus = "not_run" | "running" | "succeeded" | "failed";
type PublishStatus = "not_sent" | "sending" | "sent" | "failed";

type ReviewItem = {
  record: CaptureRecord;
  stage: ReviewStage;
  ocrStatus: OcrStatus;
  publishStatus: PublishStatus;
  reviewedText: string;
  reviewerMemo: string;
};

type AdminReviewPrototypeProps = {
  initialRecords: CaptureRecord[];
  outputRoot: string;
};

const columns: Array<{ stage: ReviewStage; title: string }> = [
  { stage: "captured", title: "撮影済み" },
  { stage: "pending_review", title: "レビュー待ち" },
  { stage: "published", title: "公開済み" }
];

const genres = ["恋愛", "友情", "学業", "部活", "行事", "上記以外", "unknown"];
const eras = ["1960", "1970", "1980", "2005", "2025"];

export function AdminReviewPrototype({
  initialRecords,
  outputRoot
}: AdminReviewPrototypeProps) {
  const [items, setItems] = useState(() => buildInitialItems(initialRecords));
  const [selectedId, setSelectedId] = useState(items[0]?.record.id ?? "");
  const [query, setQuery] = useState("");
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      const record = item.record;
      const haystack = [
        record.id,
        record.operator.name,
        record.memory.nickname,
        record.memory.genre,
        record.memory.era,
        record.memory.latitude,
        record.memory.longitude,
        item.reviewedText,
        item.reviewerMemo
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [items, query]);

  const selectedItem = selectedId
    ? items.find((item) => item.record.id === selectedId) ?? null
    : null;
  const editingText = selectedItem
    ? draftTexts[selectedItem.record.id] ?? selectedItem.reviewedText
    : "";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedId("");
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        saveDraft();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        approveSelected();
        return;
      }

      if (isTyping) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function moveSelection(direction: 1 | -1) {
    if (visibleItems.length === 0) return;
    const currentIndex = Math.max(
      0,
      visibleItems.findIndex((item) => item.record.id === selectedId)
    );
    const nextIndex = clampIndex(currentIndex + direction, visibleItems.length);
    setSelectedId(visibleItems[nextIndex].record.id);
  }

  function updateItem(id: string, update: (item: ReviewItem) => ReviewItem) {
    setItems((current) =>
      current.map((item) => (item.record.id === id ? update(item) : item))
    );
  }

  function saveDraft() {
    if (!selectedItem) return;
    updateItem(selectedItem.record.id, (item) => ({
      ...item,
      reviewedText: editingText
    }));
    setDraftTexts((current) => {
      const next = { ...current };
      delete next[selectedItem.record.id];
      return next;
    });
  }

  function approveSelected() {
    if (!selectedItem) return;
    approveItem(selectedItem.record.id, editingText.trim() || selectedItem.reviewedText);
  }

  function approveItem(id: string, reviewedText?: string) {
    updateItem(id, (item) => ({
      ...item,
      stage: "published",
      publishStatus: "sending",
      reviewedText: reviewedText?.trim() || item.reviewedText
    }));
    window.setTimeout(() => {
      updateItem(id, (item) => ({
        ...item,
        publishStatus: "sent"
      }));
    }, 600);

    const nextReview = visibleItems.find(
      (item) => item.stage === "pending_review" && item.record.id !== id
    );
    if (nextReview) {
      setSelectedId(nextReview.record.id);
    }
  }

  return (
    <main className="min-h-screen px-5 py-5">
      <div className="mx-auto grid max-w-[1680px] gap-4">
        <header className="border-2 border-[var(--line)] bg-[var(--ink)] px-4 py-2 text-white shadow-[5px_5px_0_var(--accent)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="display-font text-xs leading-tight text-[var(--accent)]">
                HCD REVIEW CONTROL
              </p>
              <h1 className="text-2xl leading-tight">レビューカンバン</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-9 w-72 border-2 border-white bg-white px-3 text-sm text-[var(--ink)] outline-none focus:shadow-[0_0_0_3px_var(--accent)]"
                placeholder="ID・名前・本文で検索"
              />
              <button
                type="button"
                className="min-h-9 border-2 border-white px-3 text-sm"
                onClick={() => setQuery("")}
              >
                クリア
              </button>
            </div>
          </div>
          <div className="mt-1 text-xs leading-tight text-white/75">
            <p className="break-all">保存先: {outputRoot}</p>
          </div>
        </header>

        {items.length === 0 ? (
          <section className="border-2 border-dashed border-[var(--line)] bg-[var(--panel-strong)] p-12 text-center text-[var(--muted)]">
            まだレビュー対象の画像はありません。
          </section>
        ) : (
          <section className="grid min-h-0 gap-4 xl:h-[calc(100vh-156px)] xl:min-h-[520px] xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,2.25fr)]">
            <ReviewPanel
              item={selectedItem}
              editingText={editingText}
              onTextChange={(value) => {
                if (!selectedItem) return;
                setDraftTexts((current) => ({
                  ...current,
                  [selectedItem.record.id]: value
                }));
              }}
              onSave={saveDraft}
              onApprove={approveSelected}
            />

            <div className="grid min-h-0 gap-4 lg:grid-cols-3">
              {columns.map((column) => {
                const columnItems = visibleItems.filter(
                  (item) => item.stage === column.stage
                );
                return (
                  <KanbanColumn
                    key={column.stage}
                    title={column.title}
                    items={columnItems}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onApprove={approveItem}
                  />
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function KanbanColumn({
  title,
  items,
  selectedId,
  onSelect,
  onApprove
}: {
  title: string;
  items: ReviewItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onApprove: (id: string, reviewedText?: string) => void;
}) {
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 border-2 border-[var(--line)] bg-[var(--panel-strong)] p-3">
      <div className="flex items-center justify-between gap-3 border-b-2 border-[var(--line)] pb-2">
        <h2 className="text-xl">{title}</h2>
        <span className="display-font border-2 border-[var(--line)] bg-[var(--accent)] px-3 py-1 text-2xl leading-none shadow-[2px_2px_0_var(--line)]">
          {items.length}
        </span>
      </div>
      <div className="grid min-h-0 content-start gap-3 overflow-y-auto pb-5 pr-1">
        {items.length === 0 ? (
          <div className="border-2 border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            空です
          </div>
        ) : (
          items.map((item) => (
            <ReviewCard
              key={item.record.id}
              item={item}
              selected={item.record.id === selectedId}
              onSelect={onSelect}
              onApprove={onApprove}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  item,
  selected,
  onSelect,
  onApprove
}: {
  item: ReviewItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onApprove: (id: string, reviewedText?: string) => void;
}) {
  const record = item.record;
  return (
    <article
      className={`border-2 bg-[var(--panel)] transition ${
        selected
          ? "border-[var(--ink)] bg-white shadow-[0_0_0_4px_var(--accent),6px_6px_0_var(--line)]"
          : "border-[var(--line)]"
      }`}
    >
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => onSelect(record.id)}
      >
        <div className="flex justify-end gap-1 border-b-2 border-[var(--line)] bg-[var(--ink)] p-1">
          <StageBadge stage={item.stage} />
          <OcrBadge status={item.ocrStatus} />
          <PublishBadge status={item.publishStatus} />
        </div>
        <div className="border-b-2 border-[var(--line)] bg-white px-3 py-2">
          <span className="display-font block break-all text-sm">{record.id}</span>
          <span className="text-xs text-[var(--muted)]">
            撮影 {formatTime(record.capture.receivedAt)} / 担当{" "}
            {record.operator.name || "未入力"}
          </span>
        </div>
        <div className="aspect-[5/3] border-b-0 border-[var(--line)] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getPublicImagePath(
              record.capture.crop?.storedFileName ?? record.capture.storedFileName
            )}
            alt={record.id}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="border-2 border-x-0 border-[var(--line)] bg-white p-2">
            <p className="mb-1 text-[11px] text-[var(--muted)]">OCR原文</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {item.reviewedText || "本文未入力"}
            </p>
        </div>
        <div className="grid gap-2 p-3">
          <div className="flex flex-wrap gap-1 text-[11px] text-[var(--muted)]">
            <span className="border border-[var(--line)] bg-white px-1.5 py-0.5">
              名前: {record.memory.nickname || "未入力"}
            </span>
            <span className="border border-[var(--line)] bg-white px-1.5 py-0.5">
              {record.memory.genre || "未入力"}
            </span>
            <span className="border border-[var(--line)] bg-white px-1.5 py-0.5">
              {record.memory.era || "年代未入力"}
            </span>
          </div>
        </div>
      </button>
      {item.stage === "pending_review" && (
        <div className="border-t-2 border-[var(--line)] p-2">
          <button
            type="button"
            className="min-h-10 w-full border-2 border-[var(--line)] bg-[var(--accent)] px-3 text-sm active:translate-y-0.5"
            onClick={() => {
              onSelect(record.id);
              onApprove(record.id, item.reviewedText);
            }}
          >
            承認して公開
          </button>
        </div>
      )}
    </article>
  );
}

function ReviewPanel({
  item,
  editingText,
  onTextChange,
  onSave,
  onApprove
}: {
  item: ReviewItem | null;
  editingText: string;
  onTextChange: (value: string) => void;
  onSave: () => void;
  onApprove: () => void;
}) {
  if (!item) {
    return (
      <aside className="border-2 border-dashed border-[var(--line)] bg-[var(--panel-strong)] p-6 text-center text-[var(--muted)]">
        カードを選択してください。
      </aside>
    );
  }

  const record = item.record;
  return (
    <aside className="sticky top-5 grid max-h-[calc(100vh-40px)] grid-rows-[auto_1fr] overflow-hidden border-2 border-[var(--line)] bg-[var(--panel-strong)]">
      <div className="border-b-2 border-[var(--line)] bg-[var(--ink)] px-3 py-2 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="display-font text-xs leading-tight text-[var(--accent)]">
              REVIEW
            </p>
            <h2 className="break-all text-base leading-tight">{record.id}</h2>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <StageBadge stage={item.stage} />
            <OcrBadge status={item.ocrStatus} />
            <PublishBadge status={item.publishStatus} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/75">
          <span>撮影 {formatTime(record.capture.receivedAt)}</span>
          <span>担当 {record.operator.name || "未入力"}</span>
        </div>
      </div>

      <div className="grid content-start gap-2 overflow-y-auto p-3">
        <section className="grid gap-0">
          <div className="border-2 border-b-0 border-[var(--line)] bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getPublicImagePath(
                record.capture.crop?.storedFileName ?? record.capture.storedFileName
              )}
              alt={record.id}
              className="aspect-[5/3] w-full object-contain"
            />
          </div>
          <div className="border-2 border-[var(--line)] bg-[var(--panel)] p-2">
            <p className="mb-1 text-xs text-[var(--muted)]">OCR原文</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {sampleOcrText(record) || "OCR結果なし"}
            </p>
          </div>
        </section>

        <section className="grid gap-2">
          <label className="grid gap-1 text-base">
            レビュー後本文
            <textarea
              value={editingText}
              onChange={(event) => onTextChange(event.target.value)}
              className="min-h-28 resize-y border-2 border-[var(--line)] bg-white px-3 py-2 text-lg leading-relaxed outline-none focus:shadow-[0_0_0_3px_var(--accent)]"
              placeholder="公開する本文を入力"
            />
          </label>
        </section>

        <section className="grid gap-1">
          <div className="grid grid-cols-2 gap-2">
            <InlineField label="書いた人" value={record.memory.nickname || ""} />
            <InlineSelect
              label="ジャンル"
              value={record.memory.genre || "unknown"}
              options={genres}
            />
          </div>
          <div className="grid grid-cols-[92px_minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <InlineSelect
              label="年代"
              value={record.memory.era || "未入力"}
              options={eras}
              compact
            />
            <InlineField label="緯度" value={record.memory.latitude || ""} />
            <InlineField
              label="経度"
              value={record.memory.longitude || ""}
            />
          </div>
        </section>

        <section className="sticky bottom-0 z-10 grid grid-cols-[0.8fr_1.2fr] gap-2 border-2 border-[var(--line)] bg-[var(--ink)] p-2 text-white shadow-[0_-3px_0_rgba(0,0,0,0.18)]">
          <button
            type="button"
            className="min-h-10 border-2 border-white bg-white px-2 text-sm text-[var(--ink)] active:translate-y-0.5"
            onClick={onSave}
          >
            保存
          </button>
          <button
            type="button"
            className="min-h-10 border-2 border-[var(--line)] bg-[var(--accent)] px-3 text-base text-[var(--ink)] shadow-[3px_3px_0_rgba(0,0,0,0.35)] active:translate-y-0.5"
            onClick={onApprove}
          >
            承認して公開
          </button>
        </section>
      </div>
    </aside>
  );
}

function InlineField({ label, value }: { label: string; value: string }) {
  return (
    <label className="grid min-h-9 grid-cols-[auto_1fr] items-center border-2 border-[var(--line)] bg-white text-sm">
      <span className="border-r-2 border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
        {label}
      </span>
      <input
        className="min-w-0 bg-white px-2 py-1 outline-none focus:shadow-[inset_0_0_0_2px_var(--accent)]"
        defaultValue={value}
      />
    </label>
  );
}

function InlineSelect({
  label,
  value,
  options,
  compact = false
}: {
  label: string;
  value: string;
  options: string[];
  compact?: boolean;
}) {
  return (
    <label
      className={`grid min-h-9 items-center border-2 border-[var(--line)] bg-white text-sm ${
        compact ? "grid-cols-[auto_74px]" : "grid-cols-[auto_1fr]"
      }`}
    >
      <span className="border-r-2 border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
        {label}
      </span>
      <select
        className="min-w-0 bg-white px-2 py-1 outline-none focus:shadow-[inset_0_0_0_2px_var(--accent)]"
        defaultValue={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function OcrBadge({ status }: { status: OcrStatus }) {
  const labelMap: Record<OcrStatus, string> = {
    not_run: "OCR未",
    running: "OCR中",
    succeeded: "OCR済",
    failed: "OCR失敗"
  };
  return <Badge label={labelMap[status]} tone={status === "failed" ? "danger" : status === "succeeded" ? "ok" : "warn"} />;
}

function PublishBadge({ status }: { status: PublishStatus }) {
  const labelMap: Record<PublishStatus, string> = {
    not_sent: "未送信",
    sending: "送信中",
    sent: "R2済",
    failed: "送信失敗"
  };
  return <Badge label={labelMap[status]} tone={status === "failed" ? "danger" : status === "sent" ? "ok" : "warn"} />;
}

function StageBadge({ stage }: { stage: ReviewStage }) {
  const labelMap: Record<ReviewStage, string> = {
    captured: "撮影済み",
    pending_review: "レビュー待ち",
    published: "公開済み"
  };
  return <Badge label={labelMap[stage]} tone={stage === "published" ? "ok" : stage === "pending_review" ? "warn" : "normal"} />;
}

function Badge({
  label,
  tone
}: {
  label: string;
  tone: "normal" | "warn" | "danger" | "ok";
}) {
  const style =
    tone === "danger"
      ? "border-[var(--danger)] bg-white text-[var(--danger)]"
      : tone === "ok"
        ? "border-[var(--ok)] bg-white text-[var(--ok)]"
        : tone === "warn"
          ? "border-[var(--warn)] bg-white text-[var(--warn)]"
          : "border-[var(--line)] bg-white text-[var(--foreground)]";
  return (
    <span className={`border-2 px-2 py-0.5 text-xs ${style}`}>
      {label}
    </span>
  );
}

function buildInitialItems(records: CaptureRecord[]): ReviewItem[] {
  return records.map((record, index) => {
    const stage: ReviewStage =
      index % 7 === 0
        ? "published"
        : index % 3 === 0
          ? "pending_review"
          : "captured";
    const ocrStatus: OcrStatus =
      stage === "captured"
        ? index % 5 === 0
          ? "failed"
          : "not_run"
        : "succeeded";
    const publishStatus: PublishStatus =
      stage === "published" ? (index % 4 === 0 ? "failed" : "sent") : "not_sent";
    return {
      record,
      stage,
      ocrStatus,
      publishStatus,
      reviewedText: record.memory.note || (stage === "captured" ? "" : sampleOcrText(record)),
      reviewerMemo: ""
    };
  });
}

function sampleOcrText(record: CaptureRecord) {
  const name = record.memory.nickname || "来場者";
  const genre = record.memory.genre && record.memory.genre !== "unknown"
    ? record.memory.genre
    : "思い出";
  const era = record.memory.era || "学生時代";
  return `${name}さんの${genre}の思い出。${era}年ごろ、この場所で過ごした時間が印象に残っています。`;
}

function getPublicImagePath(fileName: string) {
  return `/api/captures/${encodeURIComponent(fileName)}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function clampIndex(value: number, length: number) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, value));
}

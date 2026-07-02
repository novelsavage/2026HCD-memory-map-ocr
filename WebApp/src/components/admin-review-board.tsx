"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Campus, CaptureRecord } from "@/lib/records";

type AdminReviewBoardProps = {
  initialRecords: CaptureRecord[];
  outputRoot: string;
};

type Draft = {
  textReviewed: string;
  nickname: string;
  genre: string;
  era: string;
  latitude: string;
  longitude: string;
  campus: Campus;
};

type Notice = {
  tone: "ok" | "warn" | "danger";
  text: string;
};

const columns: Array<{ status: CaptureRecord["status"]; title: string }> = [
  { status: "captured", title: "撮影済み" },
  { status: "pending_review", title: "レビュー待ち" },
  { status: "published", title: "公開済み" }
];

const genres = ["恋愛", "友情", "学業", "部活", "行事", "上記以外", "unknown"];
const eras = ["1960", "1970", "1980", "2005", "2025"];

export function AdminReviewBoard({
  initialRecords,
  outputRoot
}: AdminReviewBoardProps) {
  const [records, setRecords] = useState(initialRecords);
  const [selectedId, setSelectedId] = useState(initialRecords[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(
    initialRecords[0] ? draftFromRecord(initialRecords[0]) : null
  );
  const [draftDirty, setDraftDirty] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const actionInFlightRef = useRef(false);
  const [reviewerName, setReviewerName] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem("hcd-reviewer-name") ?? ""
  );
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedRecord = selectedId
    ? records.find((record) => record.id === selectedId) ?? null
    : null;

  const visibleRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return records;
    return records.filter((record) =>
      [
        record.id,
        record.operator.name,
        record.memory.nickname,
        record.memory.genre,
        record.memory.era,
        record.memory.latitude,
        record.memory.longitude,
        record.ocr.textRaw,
        record.ocr.textReviewed
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [records, query]);

  useEffect(() => {
    window.localStorage.setItem("hcd-reviewer-name", reviewerName);
  }, [reviewerName]);

  useEffect(() => {
    const refresh = () => {
      void refreshRecords({ quiet: true });
    };
    const interval = window.setInterval(
      refresh,
      document.visibilityState === "visible" ? 5000 : 30000
    );
    return () => window.clearInterval(interval);
  });

  function selectRecord(record: CaptureRecord) {
    setSelectedId(record.id);
    setDraft(draftFromRecord(record));
    setDraftDirty(false);
  }

  async function refreshRecords({ quiet = false } = {}) {
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      if (!response.ok) throw new Error("records refresh failed");
      const payload = (await response.json()) as {
        records: CaptureRecord[];
      };
      setRecords(payload.records);
      if (!draftDirty) {
        const refreshedSelected = payload.records.find(
          (record) => record.id === selectedId
        );
        setDraft(refreshedSelected ? draftFromRecord(refreshedSelected) : null);
      }
      if (!quiet) setNotice({ tone: "ok", text: "最新の状態に更新しました。" });
    } catch {
      if (!quiet) {
        setNotice({ tone: "danger", text: "レコードの更新に失敗しました。" });
      }
    }
  }

  async function saveSelected() {
    if (!selectedRecord || !draft) return;
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const result = await sendRecordRequest(`/api/records/${selectedRecord.id}`, {
        method: "PATCH",
        body: JSON.stringify(payloadFromDraft(selectedRecord, draft, reviewerName))
      });
      handleRecordResult(result, "保存しました。");
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function approveSelected() {
    if (!selectedRecord || !draft) return;
    if (selectedRecord.status !== "pending_review") {
      setNotice({
        tone: "warn",
        text: "承認できるのはレビュー待ちの付箋だけです。"
      });
      return;
    }
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const result = await sendRecordRequest(
        `/api/records/${selectedRecord.id}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            action: "approve-and-publish",
            ...payloadFromDraft(selectedRecord, draft, reviewerName)
          })
        }
      );
      handleRecordResult(result, "承認して公開済みに移動しました。", {
        selectNextPending: true
      });
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function approveRecord(record: CaptureRecord) {
    if (record.status !== "pending_review") return;
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    const currentDraft =
      selectedRecord?.id === record.id && draft ? draft : draftFromRecord(record);
    selectRecord(record);
    setSaving(true);
    setNotice(null);
    try {
      const result = await sendRecordRequest(`/api/records/${record.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: "approve-and-publish",
          ...payloadFromDraft(record, currentDraft, reviewerName)
        })
      });
      handleRecordResult(result, "承認して公開済みに移動しました。", {
        selectNextPending: true
      });
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  }

  function handleRecordResult(
    result: Awaited<ReturnType<typeof sendRecordRequest>>,
    successMessage: string,
    options: { selectNextPending?: boolean } = {}
  ) {
    if (result.status === 409 && result.record) {
      const latestRecord = result.record;
      setRecords((current) => replaceRecord(current, latestRecord));
      setNotice({
        tone: "warn",
        text: "他のユーザーが先に更新しました。入力内容を確認してから再保存してください。"
      });
      return;
    }
    if (!result.ok || !result.record) {
      setNotice({
        tone: "danger",
        text: result.message || "更新に失敗しました。"
      });
      return;
    }
    const nextRecord = result.record;
    const nextRecords = replaceRecord(records, nextRecord);
    setRecords(nextRecords);
    const nextSelection =
      options.selectNextPending && nextRecord.status === "published"
        ? nextRecords.find(
            (record) =>
              record.status === "pending_review" && record.id !== nextRecord.id
          ) ?? nextRecord
        : nextRecord;
    setSelectedId(nextSelection.id);
    setDraft(draftFromRecord(nextSelection));
    setDraftDirty(false);
    setNotice({ tone: "ok", text: successMessage });
  }

  function updateDraft(update: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
    setDraftDirty(true);
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
              <label className="grid gap-0.5 text-xs text-white/75">
                レビュワー
                <input
                  value={reviewerName}
                  onChange={(event) => setReviewerName(event.target.value)}
                  className="min-h-9 w-36 border-2 border-white bg-white px-2 text-sm text-[var(--ink)] outline-none focus:shadow-[0_0_0_3px_var(--accent)]"
                  placeholder="名前"
                />
              </label>
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
              <button
                type="button"
                className="min-h-9 border-2 border-white px-3 text-sm"
                onClick={() => refreshRecords()}
              >
                更新
              </button>
            </div>
          </div>
          <div className="mt-1 text-xs leading-tight text-white/75">
            <p className="break-all">保存先: {outputRoot}</p>
            <p className="mt-1">
              レビュー本文入力中: Alt+Enter 保存 / Ctrl+Enter 承認
            </p>
          </div>
        </header>

        {notice && (
          <div
            className={`border-2 px-3 py-2 text-sm ${
              notice.tone === "danger"
                ? "border-[var(--danger)] bg-white text-[var(--danger)]"
                : notice.tone === "warn"
                  ? "border-[var(--warn)] bg-white text-[var(--warn)]"
                  : "border-[var(--ok)] bg-white text-[var(--ok)]"
            }`}
          >
            {notice.text}
          </div>
        )}

        {records.length === 0 ? (
          <section className="border-2 border-dashed border-[var(--line)] bg-[var(--panel-strong)] p-12 text-center text-[var(--muted)]">
            まだレビュー対象の画像はありません。
          </section>
        ) : (
          <section className="grid min-h-0 gap-4 xl:h-[calc(100vh-156px)] xl:min-h-[520px] xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,2.25fr)]">
            <ReviewPanel
              record={selectedRecord}
              draft={draft}
              saving={saving}
              onDraftChange={updateDraft}
              onSave={saveSelected}
              onApprove={approveSelected}
            />

            <div className="grid min-h-0 gap-4 lg:grid-cols-3">
              {columns.map((column) => {
                const columnRecords = visibleRecords.filter(
                  (record) => record.status === column.status
                );
                return (
                  <KanbanColumn
                    key={column.status}
                    title={column.title}
                    records={columnRecords}
                    selectedId={selectedId}
                    onSelect={(id) => {
                      const record = records.find((item) => item.id === id);
                      if (record) selectRecord(record);
                    }}
                    onApprove={approveRecord}
                    disabled={saving}
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
  records,
  selectedId,
  onSelect,
  onApprove,
  disabled
}: {
  title: string;
  records: CaptureRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onApprove: (record: CaptureRecord) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 border-2 border-[var(--line)] bg-[var(--panel-strong)] p-3">
      <div className="flex items-center justify-between gap-3 border-b-2 border-[var(--line)] pb-2">
        <h2 className="text-xl">{title}</h2>
        <span className="display-font border-2 border-[var(--line)] bg-[var(--accent)] px-3 py-1 text-2xl leading-none shadow-[2px_2px_0_var(--line)]">
          {records.length}
        </span>
      </div>
      <div className="grid min-h-0 content-start gap-3 overflow-y-auto pb-5 pr-1">
        {records.length === 0 ? (
          <div className="border-2 border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            空です
          </div>
        ) : (
          records.map((record) => (
            <ReviewCard
              key={record.id}
              record={record}
              selected={record.id === selectedId}
              onSelect={onSelect}
              onApprove={onApprove}
              disabled={disabled}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  record,
  selected,
  onSelect,
  onApprove,
  disabled
}: {
  record: CaptureRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  onApprove: (record: CaptureRecord) => void;
  disabled: boolean;
}) {
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
          <StageBadge status={record.status} />
          <OcrBadge status={record.ocr.status} />
          <PublishBadge status={record.publish.status} />
        </div>
        <div className="border-b-2 border-[var(--line)] bg-white px-3 py-2">
          <span className="display-font block break-all text-sm">{record.id}</span>
          <span className="text-xs text-[var(--muted)]">
            撮影 {formatTime(record.capture.receivedAt)} / 担当{" "}
            {record.operator.name || "未入力"}
          </span>
        </div>
        <div className="aspect-[5/3] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getPublicImagePath(
              record.capture.crop?.storedFileName ?? record.capture.storedFileName
            )}
            alt={record.id}
            className="h-full w-full object-cover"
          />
        </div>
        <CardTextBlocks record={record} />
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
      {record.status === "pending_review" && (
        <div className="border-t-2 border-[var(--line)] p-2">
          <button
            type="button"
            className="min-h-10 w-full border-2 border-[var(--line)] bg-[var(--accent)] px-3 text-sm active:translate-y-0.5"
            onClick={() => onApprove(record)}
            disabled={disabled}
          >
            承認して公開
          </button>
        </div>
      )}
    </article>
  );
}

function CardTextBlocks({ record }: { record: CaptureRecord }) {
  if (record.status === "captured") return null;

  if (record.status === "published") {
    return (
      <TextBlock
        label="レビュー後本文"
        text={record.ocr.textReviewed || "レビュー本文なし"}
      />
    );
  }

  return (
    <div className="grid">
      <TextBlock label="OCR原文" text={record.ocr.textRaw || "OCR結果なし"} />
      <TextBlock
        label="レビュー後本文"
        text={record.ocr.textReviewed || "レビュー本文なし"}
      />
    </div>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-2 border-x-0 border-[var(--line)] bg-white p-2">
      <p className="mb-1 text-[11px] text-[var(--muted)]">{label}</p>
      <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
        {text}
      </p>
    </div>
  );
}

function ReviewPanel({
  record,
  draft,
  saving,
  onDraftChange,
  onSave,
  onApprove
}: {
  record: CaptureRecord | null;
  draft: Draft | null;
  saving: boolean;
  onDraftChange: (update: Partial<Draft>) => void;
  onSave: () => void;
  onApprove: () => void;
}) {
  if (!record || !draft) {
    return (
      <aside className="border-2 border-dashed border-[var(--line)] bg-[var(--panel-strong)] p-6 text-center text-[var(--muted)]">
        カードを選択してください。
      </aside>
    );
  }

  return (
    <aside className="review-panel sticky top-5 grid max-h-[calc(100vh-40px)] grid-rows-[auto_1fr] overflow-hidden border-2 border-[var(--line)] bg-[var(--panel-strong)]">
      <div className="border-b-2 border-[var(--line)] bg-[var(--ink)] px-3 py-2 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="display-font text-xs leading-tight text-[var(--accent)]">
              REVIEW
            </p>
            <h2 className="break-all text-base leading-tight">{record.id}</h2>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <StageBadge status={record.status} />
            <OcrBadge status={record.ocr.status} />
            <PublishBadge status={record.publish.status} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/75">
          <span>撮影 {formatTime(record.capture.receivedAt)}</span>
          <span>担当 {record.operator.name || "未入力"}</span>
          <span>v{record.version}</span>
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
          {record.status === "pending_review" && (
          <div className="border-2 border-[var(--line)] bg-[var(--panel)] p-2">
            <p className="mb-1 text-xs text-[var(--muted)]">OCR原文</p>
            <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
              {record.ocr.textRaw || "OCR結果なし"}
            </p>
          </div>
          )}
        </section>

        {record.status !== "captured" && (
        <section className="grid gap-2">
          <label className="grid gap-1 text-base">
            レビュー後本文
            <AutoResizeTextarea
              value={draft.textReviewed}
              onChange={(event) =>
                onDraftChange({ textReviewed: event.target.value })
              }
              onSave={onSave}
              onApprove={onApprove}
              placeholder="公開する本文を入力"
            />
          </label>
        </section>
        )}

        <section className="grid gap-1">
          <div className="grid grid-cols-2 gap-2">
            <InlineField
              label="書いた人"
              value={draft.nickname}
              onChange={(nickname) => onDraftChange({ nickname })}
            />
            <InlineSelect
              label="ジャンル"
              value={draft.genre}
              options={genres}
              onChange={(genre) => onDraftChange({ genre })}
            />
          </div>
          <div className="grid grid-cols-[92px_minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <InlineSelect
              label="年代"
              value={draft.era}
              options={eras}
              compact
              onChange={(era) => onDraftChange({ era })}
            />
            <InlineField
              label="緯度"
              value={draft.latitude}
              onChange={(latitude) => onDraftChange({ latitude })}
            />
            <InlineField
              label="経度"
              value={draft.longitude}
              onChange={(longitude) => onDraftChange({ longitude })}
            />
          </div>
          <div className="grid gap-1">
            <p className="text-xs text-[var(--muted)]">大学内 / 大学外</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "inside", label: "大学内" },
                { value: "outside", label: "大学外" }
              ] as Array<{ value: Campus; label: string }>).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={draft.campus === option.value}
                  className={`min-h-9 border-2 border-[var(--line)] px-2 text-sm active:translate-y-0.5 ${
                    draft.campus === option.value ? "bg-[var(--accent)]" : "bg-white"
                  }`}
                  onClick={() => onDraftChange({ campus: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {draft.campus === "unknown" && (
              <p className="text-xs text-[var(--danger)]">
                大学内/外を判定してください
              </p>
            )}
          </div>
        </section>

        <section className="sticky bottom-0 z-10 grid grid-cols-[0.8fr_1.2fr] gap-2 border-2 border-[var(--line)] bg-[var(--ink)] p-2 text-white shadow-[0_-3px_0_rgba(0,0,0,0.18)]">
          <button
            type="button"
            className="min-h-10 border-2 border-white bg-white px-2 text-sm text-[var(--ink)] disabled:opacity-60 active:translate-y-0.5"
            onClick={onSave}
            disabled={saving}
          >
            <span className="shortcut-default">保存</span>
            <span className="shortcut-focused">
              Alt+Enterで保存
            </span>
          </button>
          <button
            type="button"
            className="min-h-10 border-2 border-[var(--line)] bg-[var(--accent)] px-3 text-base text-[var(--ink)] shadow-[3px_3px_0_rgba(0,0,0,0.35)] disabled:opacity-60 active:translate-y-0.5"
            onClick={onApprove}
            disabled={
              saving ||
              record.status !== "pending_review" ||
              draft.campus === "unknown"
            }
          >
            {record.status === "pending_review"
              ? draft.campus === "unknown"
                ? "大学内/外を判定してください"
                : (
                    <>
                      <span className="shortcut-default">
                        承認して公開
                      </span>
                      <span className="shortcut-focused">
                        Ctrl+Enterで承認
                      </span>
                    </>
                  )
              : record.status === "published"
                ? "公開済み"
                : "OCR後に承認"}
          </button>
        </section>
      </div>
    </aside>
  );
}

function AutoResizeTextarea({
  value,
  onChange,
  onSave,
  onApprove,
  placeholder
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSave: () => void;
  onApprove: () => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.max(element.scrollHeight, 112)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        if (event.altKey) {
          event.preventDefault();
          onSave();
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          onApprove();
        }
      }}
      className="review-textarea min-h-28 resize-none overflow-hidden border-2 border-[var(--line)] bg-white px-3 py-2 text-lg leading-relaxed outline-none focus:shadow-[0_0_0_3px_var(--accent)]"
      placeholder={placeholder}
    />
  );
}

function InlineField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-h-9 grid-cols-[auto_1fr] items-center border-2 border-[var(--line)] bg-white text-sm">
      <span className="border-r-2 border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
        {label}
      </span>
      <input
        className="min-w-0 bg-white px-2 py-1 outline-none focus:shadow-[inset_0_0_0_2px_var(--accent)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function InlineSelect({
  label,
  value,
  options,
  onChange,
  compact = false
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
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

function OcrBadge({ status }: { status: CaptureRecord["ocr"]["status"] }) {
  const labelMap: Record<CaptureRecord["ocr"]["status"], string> = {
    not_run: "OCR未",
    running: "OCR中",
    succeeded: "OCR済",
    failed: "OCR失敗"
  };
  return (
    <Badge
      label={labelMap[status]}
      tone={status === "failed" ? "danger" : status === "succeeded" ? "ok" : "warn"}
    />
  );
}

function PublishBadge({ status }: { status: CaptureRecord["publish"]["status"] }) {
  const labelMap: Record<CaptureRecord["publish"]["status"], string> = {
    not_sent: "未送信",
    sending: "送信中",
    sent: "R2済",
    failed: "送信失敗"
  };
  return (
    <Badge
      label={labelMap[status]}
      tone={status === "failed" ? "danger" : status === "sent" ? "ok" : "warn"}
    />
  );
}

function StageBadge({ status }: { status: CaptureRecord["status"] }) {
  const labelMap: Record<CaptureRecord["status"], string> = {
    captured: "撮影済み",
    pending_review: "レビュー待ち",
    published: "公開済み"
  };
  return (
    <Badge
      label={labelMap[status]}
      tone={
        status === "published" ? "ok" : status === "pending_review" ? "warn" : "normal"
      }
    />
  );
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
  return <span className={`border-2 px-2 py-0.5 text-xs ${style}`}>{label}</span>;
}

function draftFromRecord(record: CaptureRecord): Draft {
  return {
    textReviewed: record.ocr.textReviewed || record.ocr.textRaw || record.memory.note,
    nickname: record.memory.nickname,
    genre: record.memory.genre || "unknown",
    era: record.memory.era,
    latitude: record.memory.latitude,
    longitude: record.memory.longitude,
    campus: record.memory.campus
  };
}

function payloadFromDraft(
  record: CaptureRecord,
  draft: Draft,
  reviewerName: string
) {
  return {
    version: record.version,
    reviewerName,
    ocr: {
      textReviewed: draft.textReviewed
    },
    memory: {
      nickname: draft.nickname,
      genre: draft.genre,
      era: draft.era,
      latitude: draft.latitude,
      longitude: draft.longitude,
      campus: draft.campus
    }
  };
}

async function sendRecordRequest(
  url: string,
  init: {
    method: string;
    body: string;
  }
) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    }
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    record?: CaptureRecord;
    message?: string;
  };
  return {
    ok: response.ok && payload.ok !== false,
    status: response.status,
    record: payload.record,
    message: payload.message
  };
}

function replaceRecord(records: CaptureRecord[], next: CaptureRecord) {
  return records.map((record) => (record.id === next.id ? next : record));
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

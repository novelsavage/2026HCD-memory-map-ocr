"use client";

import { useMemo, useState } from "react";
import type { CaptureRecord } from "@/lib/records";

type AdminDashboardProps = {
  initialRecords: CaptureRecord[];
  outputRoot: string;
};

export function AdminDashboard({
  initialRecords,
  outputRoot
}: AdminDashboardProps) {
  const [records, setRecords] = useState(initialRecords);
  const [loading, setLoading] = useState(false);

  const summary = useMemo(() => {
    return {
      total: records.length,
      unsent: records.filter((record) => !record.sync.labPcSent).length,
      errors: records.filter((record) => record.sync.lastError).length
    };
  }, [records]);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/records");
      const payload = await response.json();
      setRecords(payload.records);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-5 py-5">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="rounded-lg border-2 border-[var(--line)] bg-[var(--ink)] p-5 text-white shadow-[6px_6px_0_var(--accent)]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="display-font text-sm text-[var(--accent)]">
                HCD CAPTURE CONTROL
              </p>
              <h1 className="mt-1 text-3xl">管理画面</h1>
            </div>
            <button
              className="rounded-md border-2 border-white px-4 py-2 disabled:opacity-50"
              disabled={loading}
              onClick={refresh}
            >
              {loading ? "更新中" : "更新"}
            </button>
          </div>
          <p className="mt-3 break-all text-sm text-white/70">保存先: {outputRoot}</p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Metric label="受信件数" value={summary.total} tone="normal" />
          <Metric label="未送信" value={summary.unsent} tone="warn" />
          <Metric label="エラー" value={summary.errors} tone="danger" />
        </section>

        <section className="rounded-lg border-2 border-[var(--line)] bg-[var(--panel-strong)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl">受信画像</h2>
            <span className="display-font text-sm">{records.length} ITEMS</span>
          </div>

          {records.length === 0 ? (
            <div className="rounded-md border-2 border-dashed border-[var(--line)] p-10 text-center text-[var(--muted)]">
              まだ画像は届いていません。
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {records.map((record) => (
                <article
                  key={record.id}
                  className="overflow-hidden rounded-lg border-2 border-[var(--line)] bg-[var(--panel)]"
                >
                  <div className="aspect-[5/3] bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getPublicImagePath(
                        record.capture.crop?.storedFileName ??
                          record.capture.storedFileName
                      )}
                      alt={record.id}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="grid gap-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="display-font text-sm">{record.id}</span>
                      <StatusBadge status={record.status} />
                    </div>
                    <dl className="grid gap-1 text-sm text-[var(--muted)]">
                      <Row label="担当" value={record.operator.name || "未入力"} />
                      <Row label="書いた人" value={record.memory.nickname || "未入力"} />
                      <Row label="ジャンル" value={record.memory.genre || "未入力"} />
                      <Row label="年代" value={record.memory.era || "未入力"} />
                      <Row
                        label="座標"
                        value={
                          record.memory.latitude && record.memory.longitude
                            ? `${record.memory.latitude}, ${record.memory.longitude}`
                            : "未入力"
                        }
                      />
                      <Row
                        label="時刻"
                        value={new Date(record.capture.receivedAt).toLocaleString(
                          "ja-JP"
                        )}
                      />
                      <Row
                        label="画像"
                        value={record.capture.crop ? "cropあり" : "元画像のみ"}
                      />
                    </dl>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function getPublicImagePath(fileName: string) {
  return `/api/captures/${encodeURIComponent(fileName)}`;
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "normal" | "warn" | "danger";
}) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "warn"
        ? "var(--warn)"
        : "var(--ok)";
  return (
    <div className="rounded-lg border-2 border-[var(--line)] bg-[var(--panel-strong)] p-4">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="display-font mt-1 text-5xl" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-md border-2 border-[var(--line)] bg-white px-2 py-1 text-xs">
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="truncate text-right text-[var(--foreground)]">{value}</dd>
    </div>
  );
}

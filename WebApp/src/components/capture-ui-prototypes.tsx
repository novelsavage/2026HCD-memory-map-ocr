"use client";

import type { PointerEvent } from "react";
import { useMemo, useRef, useState } from "react";

type CapturePrototypeId =
  | "single-flow"
  | "camera-first"
  | "map-first"
  | "staff-kiosk"
  | "review-dock";

type CapturePrototype = {
  id: CapturePrototypeId;
  label: string;
  title: string;
  tag: string;
  intent: string;
  layout: "stack" | "split" | "dock";
};

type PrototypeState = {
  hasImage: boolean;
  selectedGenre: string;
  selectedMapIndex: number;
  selectedMapEra: string;
  mapLocked: boolean;
  mapOffset: MapOffset;
  setHasImage: (value: boolean) => void;
  setSelectedGenre: (value: string) => void;
  setSelectedMapIndex: (value: number) => void;
  setSelectedMapEra: (value: string) => void;
  setMapLocked: (value: boolean) => void;
  setMapOffset: (value: MapOffset) => void;
};

type MapOffset = {
  x: number;
  y: number;
};

type LatLng = {
  lat: number;
  lng: number;
};

const capturePrototypes: CapturePrototype[] = [
  {
    id: "single-flow",
    label: "案A",
    title: "1画面で順に埋める",
    tag: "ONE SCREEN",
    intent: "撮影、地図仮置き、入力、確認を縦に並べる標準案。",
    layout: "stack"
  },
  {
    id: "camera-first",
    label: "案B",
    title: "撮影を大きく見せる",
    tag: "BIG CAMERA",
    intent: "シャッター直後に名前と分類を下で素早く入れる案。",
    layout: "split"
  },
  {
    id: "map-first",
    label: "案C",
    title: "座標仮置きを主役にする",
    tag: "MAP PIN",
    intent: "地図位置の取り違えを減らすため、ミニマップを常時見せる案。",
    layout: "split"
  },
  {
    id: "staff-kiosk",
    label: "案D",
    title: "担当者固定の連続入力",
    tag: "STAFF LOCK",
    intent: "スタッフ名は保存済み表示にして、来場者入力だけを目立たせる案。",
    layout: "dock"
  },
  {
    id: "review-dock",
    label: "案E",
    title: "送信前レビュー重視",
    tag: "REVIEW",
    intent: "撮影画像、分類、座標を最後に一列で見直して送る案。",
    layout: "dock"
  }
];

const genres = ["恋愛", "友情", "学業", "部活", "行事", "上記以外"];
const erasTop = ["1960", "1970", "1980"];
const erasBottom = ["2005", "2025"];
const eras = [...erasTop, ...erasBottom];

const fieldBase =
  "w-full rounded-md border-2 border-[var(--line)] bg-white px-3 py-3 text-base outline-none focus:shadow-[0_0_0_3px_var(--accent)]";

export function CaptureUiPrototypes({
  initialPrototypeId = "single-flow"
}: {
  initialPrototypeId?: CapturePrototypeId;
}) {
  const [activeId, setActiveId] =
    useState<CapturePrototypeId>(initialPrototypeId);
  const [hasImage, setHasImage] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState("友情");
  const [selectedMapIndex, setSelectedMapIndex] = useState(8);
  const [selectedMapEra, setSelectedMapEra] = useState("1970");
  const [mapLocked, setMapLocked] = useState(false);
  const [mapOffset, setMapOffset] = useState<MapOffset>({ x: -18, y: 14 });
  const activePrototype = useMemo(
    () =>
      capturePrototypes.find((prototype) => prototype.id === activeId) ??
      capturePrototypes[0],
    [activeId]
  );
  const prototypeState = {
    hasImage,
    selectedGenre,
    selectedMapIndex,
    selectedMapEra,
    mapLocked,
    mapOffset,
    setHasImage,
    setSelectedGenre,
    setSelectedMapIndex,
    setSelectedMapEra,
    setMapLocked,
    setMapOffset
  };

  return (
    <main className="min-h-screen px-4 py-5">
      <div className="mx-auto grid w-full max-w-md gap-4">
        <header className="rounded-lg border-2 border-[var(--line)] bg-[var(--panel)] p-4 shadow-[5px_5px_0_var(--line)]">
          <p className="display-font text-sm text-[var(--accent-strong)]">
            HCD CAPTURE UI PROTOTYPES
          </p>
          <h1 className="mt-1 text-3xl leading-tight">スマホ入力案</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            既存画面とは別ルートで試すための、同一画面入力プロトタイプです。
          </p>
        </header>

        <PrototypeTabs
          activeId={activeId}
          prototypes={capturePrototypes}
          onChange={setActiveId}
        />

        <PrototypeShell prototype={activePrototype}>
          {activePrototype.id === "single-flow" ? (
            <SingleFlowPrototype prototypeState={prototypeState} />
          ) : null}
          {activePrototype.id === "camera-first" ? (
            <CameraFirstPrototype prototypeState={prototypeState} />
          ) : null}
          {activePrototype.id === "map-first" ? (
            <MapFirstPrototype prototypeState={prototypeState} />
          ) : null}
          {activePrototype.id === "staff-kiosk" ? (
            <StaffKioskPrototype prototypeState={prototypeState} />
          ) : null}
          {activePrototype.id === "review-dock" ? (
            <ReviewDockPrototype prototypeState={prototypeState} />
          ) : null}
        </PrototypeShell>
      </div>
    </main>
  );
}

export { capturePrototypes, erasBottom, erasTop, genres };
export type { CapturePrototype, CapturePrototypeId };

function PrototypeTabs({
  activeId,
  prototypes,
  onChange
}: {
  activeId: CapturePrototypeId;
  prototypes: CapturePrototype[];
  onChange: (id: CapturePrototypeId) => void;
}) {
  return (
    <nav className="grid grid-cols-5 gap-2">
      {prototypes.map((prototype) => (
        <a
          key={prototype.id}
          aria-current={activeId === prototype.id ? "page" : undefined}
          className={`touch-manipulation rounded-md border-2 border-[var(--line)] px-2 py-3 text-center text-sm ${
            activeId === prototype.id
              ? "bg-[var(--accent)]"
              : "bg-[var(--panel-strong)]"
          }`}
          href={`/prototypes/capture-ui?variant=${prototype.id}`}
          onClick={(event) => {
            event.preventDefault();
            window.history.replaceState(
              null,
              "",
              `/prototypes/capture-ui?variant=${prototype.id}`
            );
            onChange(prototype.id);
          }}
        >
          {prototype.label}
        </a>
      ))}
    </nav>
  );
}

function PrototypeShell({
  prototype,
  children
}: {
  prototype: CapturePrototype;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="rounded-lg border-2 border-[var(--line)] bg-[var(--ink)] p-4 text-white shadow-[5px_5px_0_var(--accent)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="display-font text-sm text-[var(--accent)]">
              {prototype.tag}
            </p>
            <h2 className="mt-1 text-2xl leading-tight">{prototype.title}</h2>
          </div>
          <span className="rounded-md border-2 border-white px-3 py-1 text-sm">
            {prototype.label}
          </span>
        </div>
        <p className="mt-3 text-sm text-white/75">{prototype.intent}</p>
      </div>
      {children}
    </section>
  );
}

function SingleFlowPrototype({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <PrototypePanel>
      <CapturePane compact={false} prototypeState={prototypeState} />
      <MiniMapPicker prototypeState={prototypeState} />
      <StaffBadge />
      <VisitorFields prototypeState={prototypeState} />
      <SubmitBar label="この内容で仮保存" />
    </PrototypePanel>
  );
}

function CameraFirstPrototype({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <PrototypePanel>
      <CapturePane compact={false} prototypeState={prototypeState} />
      <div className="grid grid-cols-[1fr_130px] gap-3">
        <div className="grid gap-3">
          <StaffBadge />
          <TextField label="書いた人の名前" placeholder="例: 山田" />
        </div>
        <MiniMapPicker dense prototypeState={prototypeState} />
      </div>
      <ChoiceBlocks prototypeState={prototypeState} />
      <SubmitBar label="撮影画像と入力を送る" />
    </PrototypePanel>
  );
}

function MapFirstPrototype({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <PrototypePanel>
      <MiniMapPicker large prototypeState={prototypeState} />
      <CapturePane compact prototypeState={prototypeState} />
      <StaffBadge />
      <VisitorFields prototypeState={prototypeState} />
      <SubmitBar label="位置を確認して送る" />
    </PrototypePanel>
  );
}

function StaffKioskPrototype({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <PrototypePanel>
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <CapturePane compact prototypeState={prototypeState} />
        <div className="grid gap-3">
          <StaffBadge strong />
          <TextField label="書いた人の名前" placeholder="名前またはニックネーム" />
        </div>
      </div>
      <MiniMapPicker prototypeState={prototypeState} />
      <ChoiceBlocks prototypeState={prototypeState} />
      <SubmitBar label="続けて保存" />
    </PrototypePanel>
  );
}

function ReviewDockPrototype({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <PrototypePanel>
      <CapturePane compact={false} prototypeState={prototypeState} />
      <div className="rounded-md border-2 border-[var(--line)] bg-[#fff7d1] p-3">
        <p className="mb-2 text-sm text-[var(--muted)]">送信前レビュー</p>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <MiniSummary label="画像" value={prototypeState.hasImage ? "撮影済み" : "未撮影"} />
          <MiniSummary
            label="座標"
            value={formatLatLng(
              getLatLngFromOffset(prototypeState.selectedMapEra, prototypeState.mapOffset)
            )}
          />
          <MiniSummary label="担当" value="保存済み" />
        </div>
      </div>
      <VisitorFields prototypeState={prototypeState} />
      <MiniMapPicker dense prototypeState={prototypeState} />
      <SubmitBar label="レビューして送信" />
    </PrototypePanel>
  );
}

function PrototypePanel({ children }: { children: React.ReactNode }) {
  return (
    <article className="grid gap-4 rounded-lg border-2 border-[var(--line)] bg-[var(--panel-strong)] p-4 pb-24">
      {children}
    </article>
  );
}

function CapturePane({
  compact,
  prototypeState
}: {
  compact?: boolean;
  prototypeState: PrototypeState;
}) {
  return (
    <section className="grid gap-3">
      <div
        className={`relative overflow-hidden rounded-md border-2 border-[var(--line)] bg-[#101820] ${
          compact ? "aspect-square" : "aspect-[4/3]"
        }`}
      >
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-white">
          <div>
            <p className="display-font text-3xl text-[var(--accent)]">
              {prototypeState.hasImage ? "CAPTURED" : "CAMERA"}
            </p>
            <p className="mt-2 text-sm text-white/70">付箋画像プレビュー</p>
          </div>
        </div>
        <div className="absolute inset-x-8 top-1/2 aspect-[5/3] -translate-y-1/2 border-2 border-[var(--accent)]" />
      </div>
      <div className="grid grid-cols-2 items-stretch gap-3">
        <button
          className="min-h-[72px] rounded-md border-2 border-[var(--line)] bg-white px-3 py-3 active:translate-y-0.5"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              prototypeState.setHasImage(true);
            }
          }}
          onPointerDown={() => prototypeState.setHasImage(true)}
          type="button"
        >
          画像を選ぶ
        </button>
        <button
          aria-label={prototypeState.hasImage ? "撮り直す" : "シャッター"}
          className="grid min-h-[72px] place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--accent)] px-4 py-2 text-center text-base leading-tight shadow-[3px_3px_0_var(--line)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--line)]"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              prototypeState.setHasImage(!prototypeState.hasImage);
            }
          }}
          onPointerDown={() => prototypeState.setHasImage(!prototypeState.hasImage)}
          type="button"
        >
          {prototypeState.hasImage ? "撮り直す" : "シャッター"}
        </button>
      </div>
    </section>
  );
}

function MiniMapPicker({
  dense = false,
  large = false,
  prototypeState
}: {
  dense?: boolean;
  large?: boolean;
  prototypeState: PrototypeState;
}) {
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const mapCanvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: MapOffset;
  } | null>(null);
  const previewIndex = getMapIndexFromOffset(prototypeState.mapOffset);
  const previewLatLng = getLatLngFromOffset(
    prototypeState.selectedMapEra,
    prototypeState.mapOffset
  );

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (prototypeState.mapLocked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: prototypeState.mapOffset
    };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || prototypeState.mapLocked) {
      return;
    }
    const bounds = getMapDragBounds(mapFrameRef.current, mapCanvasRef.current);
    prototypeState.setMapOffset({
      x: clamp(
        drag.origin.x + event.clientX - drag.startX,
        -bounds.x,
        bounds.x
      ),
      y: clamp(
        drag.origin.y + event.clientY - drag.startY,
        -bounds.y,
        bounds.y
      )
    });
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  function lockCoordinate() {
    prototypeState.setSelectedMapIndex(previewIndex);
    prototypeState.setMapLocked(true);
  }

  function unlockCoordinate() {
    prototypeState.setMapLocked(false);
  }

  return (
    <section className="grid gap-3">
      <div className="relative z-30 grid grid-cols-[1fr_auto] items-start gap-2">
        <div>
          <h3 className="text-base">座標ミニマップ仮置き</h3>
          <span className="mt-1 inline-block rounded-md border-2 border-[var(--line)] bg-white px-2 py-1 text-xs">
            {prototypeState.selectedMapEra} / {formatLatLng(previewLatLng)}
          </span>
        </div>
        <button
          data-testid="coordinate-lock-button"
          className={`rounded-md border-2 border-[var(--line)] px-3 py-2 text-sm active:translate-y-0.5 ${
            prototypeState.mapLocked ? "bg-white" : "bg-[var(--accent)]"
          }`}
          onClick={prototypeState.mapLocked ? unlockCoordinate : lockCoordinate}
          type="button"
        >
          {prototypeState.mapLocked ? "指定しなおす" : "座標を指定"}
        </button>
      </div>

      <div className="grid gap-0">
        <div className="relative z-10 grid grid-cols-5 gap-0 px-0">
          {eras.map((era) => (
            <button
              key={era}
              aria-pressed={prototypeState.selectedMapEra === era}
              className={`min-h-10 rounded-t-md border-2 border-b-0 border-[var(--line)] px-1 text-sm active:translate-y-0.5 ${
                prototypeState.selectedMapEra === era
                  ? "bg-[var(--panel)]"
                  : "bg-white"
              }`}
              onPointerDown={() => {
                prototypeState.setSelectedMapEra(era);
                prototypeState.setMapLocked(false);
              }}
              onClick={() => {
                prototypeState.setSelectedMapEra(era);
                prototypeState.setMapLocked(false);
              }}
              type="button"
            >
              {era}
            </button>
          ))}
        </div>

        <div
          ref={mapFrameRef}
          className={`relative touch-none overflow-hidden rounded-md rounded-t-none border-2 border-[var(--line)] bg-[var(--panel)] ${
            large ? "aspect-[5/3]" : dense ? "aspect-square" : "aspect-[3/2]"
          }`}
          onPointerCancel={endDrag}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        >
          <div
          ref={mapCanvasRef}
          className={`absolute -inset-32 grid grid-cols-5 grid-rows-4 transition-opacity ${
            prototypeState.mapLocked ? "opacity-80" : "opacity-100"
          }`}
          style={{
            transform: `translate(${prototypeState.mapOffset.x}px, ${prototypeState.mapOffset.y}px)`
          }}
        >
          {Array.from({ length: 20 }).map((_, index) => {
            return (
              <div
                key={index}
                className="grid place-items-center border border-[rgba(35,35,35,0.2)] bg-white/60 text-xs"
              >
                <span>{index + 1}</span>
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_15px,rgba(16,24,32,0.10)_16px,transparent_17px)]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-1/2 top-0 h-5 w-[3px] -translate-x-1/2 bg-[var(--line)]" />
          <div className="absolute bottom-0 left-1/2 h-5 w-[3px] -translate-x-1/2 bg-[var(--line)]" />
          <div className="absolute left-0 top-1/2 h-[3px] w-5 -translate-y-1/2 bg-[var(--line)]" />
          <div className="absolute right-0 top-1/2 h-[3px] w-5 -translate-y-1/2 bg-[var(--line)]" />
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-strong)]" />
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border-2 border-[var(--line)] bg-white/90 px-2 py-1 text-[11px]">
          {formatLatLng(previewLatLng)}
        </div>
        </div>
      </div>

      <div className="grid items-center gap-3">
        <p className="text-xs text-[var(--muted)]">
          {prototypeState.mapLocked
            ? "座標を固定中。指定しなおすと地図を動かせます。"
            : "地図を動かして、中央ピンの位置で指定します。"}
        </p>
      </div>
    </section>
  );
}

function StaffBadge({ strong = false }: { strong?: boolean }) {
  return (
    <section
      className={`rounded-md border-2 border-[var(--line)] p-3 ${
        strong ? "bg-[var(--accent)]" : "bg-[#fff7d1]"
      }`}
    >
      <p className="text-xs text-[var(--muted)]">スタッフ担当者名（保存済み）</p>
      <p className="mt-1 text-lg">受付スタッフ A</p>
    </section>
  );
}

function VisitorFields({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <section className="grid gap-3">
      <TextField label="書いた人の名前" placeholder="例: 佐藤 / ニックネーム可" />
      <ChoiceBlocks prototypeState={prototypeState} />
    </section>
  );
}

function ChoiceBlocks({
  prototypeState
}: {
  prototypeState: PrototypeState;
}) {
  return (
    <div className="grid gap-3">
      <SegmentedChoice
        label="ジャンル"
        items={genres}
        columns="grid-cols-3"
        selectedItem={prototypeState.selectedGenre}
        onSelect={prototypeState.setSelectedGenre}
      />
    </div>
  );
}

function SegmentedChoice({
  label,
  items,
  columns,
  selectedItem,
  onSelect
}: {
  label: string;
  items: string[];
  columns: string;
  selectedItem: string;
  onSelect: (item: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm">{label}</p>
      <div className={`grid ${columns} gap-2`}>
        {items.map((item) => (
          <ChoiceButton
            key={item}
            label={item}
            selected={item === selectedItem}
            onClick={() => onSelect(item)}
          />
        ))}
      </div>
    </div>
  );
}

function ChoiceButton({
  label,
  selected = false,
  onClick
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`min-h-12 rounded-md border-2 border-[var(--line)] px-2 py-2 text-sm active:translate-y-0.5 ${
        selected ? "bg-[var(--accent)]" : "bg-white"
      }`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onClick?.();
        }
      }}
      onPointerDown={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function TextField({
  label,
  placeholder
}: {
  label: string;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input className={fieldBase} placeholder={placeholder} />
    </label>
  );
}

function SubmitBar({ label }: { label: string }) {
  return (
    <footer className="sticky bottom-3 z-10 rounded-md border-2 border-[var(--line)] bg-[var(--panel)] p-2 shadow-[4px_4px_0_var(--line)]">
      <button
        className="w-full rounded-md border-2 border-[var(--line)] bg-[var(--accent)] px-4 py-3 text-lg"
        type="button"
      >
        {label}
      </button>
    </footer>
  );
}

function MiniSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-2 border-[var(--line)] bg-white px-2 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1">{value}</p>
    </div>
  );
}

function getMapIndexFromOffset(offset: MapOffset) {
  const column = clamp(Math.round((240 - offset.x) / 120), 0, 4);
  const row = clamp(Math.round((180 - offset.y) / 120), 0, 3);
  return row * 5 + column;
}

function getMapDragBounds(
  frame: HTMLDivElement | null,
  canvas: HTMLDivElement | null
) {
  if (!frame || !canvas) {
    return { x: 260, y: 220 };
  }

  return {
    x: Math.max(0, canvas.offsetWidth / 2),
    y: Math.max(0, canvas.offsetHeight / 2)
  };
}

function getLatLngFromOffset(era: string, offset: MapOffset): LatLng {
  const eraIndex = Math.max(0, eras.indexOf(era));
  const baseLat = 35.8321 + eraIndex * 0.00018;
  const baseLng = 139.9552 + eraIndex * 0.00022;

  return {
    lat: roundCoordinate(baseLat - offset.y * 0.000012),
    lng: roundCoordinate(baseLng - offset.x * 0.000012)
  };
}

function formatLatLng(latLng: LatLng) {
  return `${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`;
}

function roundCoordinate(value: number) {
  return Math.round(value * 1000000) / 1000000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

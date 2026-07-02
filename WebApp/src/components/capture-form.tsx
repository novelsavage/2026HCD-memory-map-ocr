"use client";

import type { PointerEvent } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

type UploadState = "idle" | "ready" | "sending" | "sent" | "failed";
type CameraState = "idle" | "starting" | "ready" | "blocked" | "unsupported";

type UploadResult = {
  id: string;
  receivedAt: string;
};

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropMeta = {
  sourceRect: CropRect;
  guideRect: CropRect;
};

type MapOffset = {
  x: number;
  y: number;
};

type LatLng = {
  lat: number;
  lng: number;
};

type Campus = "inside" | "outside" | "unknown";

const genres = ["恋愛", "友情", "学業", "部活", "行事", "上記以外"];
// ジャンル別カラー（彩度をそろえたパステル＋「上記以外」のみ濃い緑）。
// 選択状態は塗り色ではなく濃い枠+チェックで表すため、部活(黄)と被らない。
const GENRE_COLORS: Record<string, { bg: string; fg: string }> = {
  "恋愛": { bg: "#ec9bb6", fg: "#192024" }, // ピンク
  "友情": { bg: "#86c5e0", fg: "#192024" }, // 水色
  "学業": { bg: "#83cf8a", fg: "#192024" }, // 緑
  "部活": { bg: "#f0cf57", fg: "#192024" }, // 黄色
  "行事": { bg: "#b9a3e3", fg: "#192024" }, // 紫
  "上記以外": { bg: "#357a5a", fg: "#ffffff" } // 濃い緑
};
const eras = ["1960", "1970", "1980", "2005", "2025"];

const ERA_MAP_IMAGES: Record<string, string> = {
  "1960": "/maps/1960.jpg",
  "1970": "/maps/1970.jpg",
  "1980": "/maps/1980.jpg",
  "2005": "/maps/2005.jpg",
  "2025": "/maps/2025.jpg",
};

const MAP_BOUNDS = {
  topLat:    35.846503431837974,
  leftLng:   139.9396836960089,
  bottomLat: 35.824255102680205,
  rightLng:  139.96551577769122,
};
const GUIDED_CROP_WIDTH = 1500;
const GUIDED_CROP_HEIGHT = 900;

const fieldBase =
  "w-full rounded-md border-2 border-[var(--line)] bg-white px-3 py-3 text-base outline-none focus:shadow-[0_0_0_3px_var(--accent)]";

export function CaptureForm() {
  const [operatorName, setOperatorName] = useState("");
  const [sentCount, setSentCount] = useState(0);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [operatorEditMode, setOperatorEditMode] = useState(false);

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropMeta, setCropMeta] = useState<CropMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);

  const [visitorName, setVisitorName] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("");
  const [selectedCampus, setSelectedCampus] = useState<Campus>("unknown");

  const [selectedEra, setSelectedEra] = useState("1970");
  const [mapOffset, setMapOffset] = useState<MapOffset>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.8);
  const [mapNaturalAspect, setMapNaturalAspect] = useState(1.0);
  const [mapFrameNode, setMapFrameNode] = useState<HTMLDivElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraFrameRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const mapImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: MapOffset;
  } | null>(null);
  const mapPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    startDist: number;
    startZoom: number;
    startOffset: MapOffset;
    startMidX: number;
    startMidY: number;
  } | null>(null);
  // Refs for stale-closure-safe access in non-React event listeners
  const zoomRef = useRef(1.8);
  const mapNaturalAspectRef = useRef(1.0);
  const mapOffsetRef = useRef<MapOffset>({ x: 0, y: 0 });

  const setMapFrameRefs = useCallback((node: HTMLDivElement | null) => {
    mapFrameRef.current = node;
    setMapFrameNode(node);
  }, []);

  const stopCameraStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedName = readLocalStorage("hcd.operatorName", "");
      setOperatorName(savedName);
      setOperatorEditMode(!savedName);
      setSentCount(Number(readLocalStorage("hcd.sentCount", "0")));
      setSettingsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  // Keep refs in sync for use in non-React event listeners
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { mapNaturalAspectRef.current = mapNaturalAspect; }, [mapNaturalAspect]);
  useEffect(() => { mapOffsetRef.current = mapOffset; }, [mapOffset]);

  // Mouse wheel zoom is attached after the client has mounted the map frame.
  useEffect(() => {
    if (!settingsLoaded) return;
    const frame = mapFrameNode;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const currentZoom = zoomRef.current;
      const newZoom = Math.max(0.8, Math.min(5.0, currentZoom + (e.deltaY < 0 ? 0.3 : -0.3)));
      const ratio = newZoom / currentZoom;
      const containerW = frame.clientWidth;
      const displayW = containerW * newZoom;
      const displayH = displayW * mapNaturalAspectRef.current;
      const cur = mapOffsetRef.current;
      setZoom(newZoom);
      setMapOffset({
        x: clamp(cur.x * ratio, -displayW / 2, displayW / 2),
        y: clamp(cur.y * ratio, -displayH / 2, displayH / 2),
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [settingsLoaded, mapFrameNode]);

  const canSend = useMemo(
    () => Boolean(file && operatorName.trim() && state !== "sending"),
    [file, operatorName, state]
  );

  function onFileChange(
    nextFile: File | null,
    options?: { cropFile?: File | null; cropMeta?: CropMeta | null }
  ) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextCropFile = options?.cropFile ?? null;
    setFile(nextFile);
    setCropFile(nextCropFile);
    setCropMeta(options?.cropMeta ?? null);
    setPreviewUrl(
      nextCropFile
        ? URL.createObjectURL(nextCropFile)
        : nextFile
          ? URL.createObjectURL(nextFile)
          : null
    );
    setState(nextFile ? "ready" : "idle");
    setError("");
  }

  async function startCamera() {
    setCameraError("");

    if (!window.isSecureContext) {
      setCameraState("blocked");
      setCameraError(
        "スマホブラウザではHTTPSでないとカメラを起動できない場合があります。画像選択を使うか、HTTPS化して起動してください。"
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      setCameraError("このブラウザではカメラ起動に対応していません。画像選択を使ってください。");
      return;
    }

    setCameraState("starting");

    try {
      stopCameraStream();
      const stream = await requestCameraStream();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("ready");
    } catch (err) {
      setCameraState("blocked");
      setCameraError(
        err instanceof Error
          ? `カメラを起動できませんでした: ${err.name} ${err.message}`
          : "カメラを起動できませんでした。画像選択を使ってください。"
      );
    }
  }

  async function requestCameraStream() {
    const attempts: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        }
      },
      {
        audio: false,
        video: {
          facingMode: "environment"
        }
      },
      {
        audio: false,
        video: true
      }
    ];

    let lastError: unknown = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function captureFromCamera() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("カメラ映像の準備がまだできていません。少し待ってからもう一度押してください。");
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("画像の切り出しに失敗しました。");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);

    if (!blob) {
      setCameraError("撮影画像の作成に失敗しました。");
      return;
    }

    const imageFile = new File([blob], "hcd-camera-original.jpg", {
      type: "image/jpeg"
    });

    const cropResult = await createGuidedCrop(video);
    onFileChange(imageFile, {
      cropFile: cropResult?.file ?? null,
      cropMeta: cropResult?.meta ?? null
    });
    setCameraError("");
  }

  async function createGuidedCrop(video: HTMLVideoElement) {
    const frame = cameraFrameRef.current;
    const guide = guideRef.current;
    if (!frame || !guide) return null;

    const sourceRect = getObjectCoverSourceRect(video, frame, guide);
    if (!sourceRect) return null;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = GUIDED_CROP_WIDTH;
    cropCanvas.height = GUIDED_CROP_HEIGHT;
    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) return null;

    cropContext.drawImage(
      video,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    const cropBlob = await canvasToBlob(cropCanvas, "image/jpeg", 0.94);
    if (!cropBlob) return null;

    const cropFileResult = new File([cropBlob], "hcd-guided-crop.jpg", {
      type: "image/jpeg"
    });
    return {
      file: cropFileResult,
      meta: {
        sourceRect,
        guideRect: rectFromElements(frame, guide)
      }
    };
  }

  async function handleNextNote() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setCropFile(null);
    setCropMeta(null);
    setPreviewUrl(null);
    setVisitorName("");
    setSelectedGenre("");
    setSelectedCampus("unknown");
    setState("idle");
    setLastResult(null);
    setError("");
    await startCamera();
  }

  async function upload() {
    if (!file) return;
    setState("sending");
    setError("");

    const body = new FormData();
    body.set("image", file);
    body.set("operatorName", operatorName);
    body.set("nickname", visitorName);
    body.set("genre", selectedGenre || "unknown");
    body.set("campus", selectedCampus);
    body.set("era", selectedEra);
    const latLng = computeLatLng(mapOffset, mapFrameRef.current, zoom, mapNaturalAspect);
    body.set("latitude", latLng.lat.toFixed(6));
    body.set("longitude", latLng.lng.toFixed(6));
    body.set("location", "");
    body.set("deviceLabel", "");
    body.set("mapArea", "");
    body.set("note", "");
    if (cropFile) {
      body.set("cropImage", cropFile);
    }
    if (cropMeta) {
      body.set("cropSourceRect", JSON.stringify(cropMeta.sourceRect));
      body.set("cropGuideRect", JSON.stringify(cropMeta.guideRect));
    }

    try {
      const response = await fetch("/api/captures", {
        method: "POST",
        body
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "upload failed");
      }
      const nextCount = sentCount + 1;
      localStorage.setItem("hcd.sentCount", String(nextCount));
      setSentCount(nextCount);
      setLastResult({
        id: payload.record.id,
        receivedAt: payload.record.capture.receivedAt
      });
      setState("sent");
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    }
  }

  const previewLatLng = computeLatLng(mapOffset, mapFrameNode, zoom, mapNaturalAspect);

  function handleMapImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth > 0) setMapNaturalAspect(img.naturalHeight / img.naturalWidth);
  }

  function onMapPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    mapPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mapPointersRef.current.size === 1) {
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: mapOffset };
      pinchStateRef.current = null;
    } else if (mapPointersRef.current.size === 2) {
      dragRef.current = null;
      const pts = [...mapPointersRef.current.values()];
      const [p1, p2] = pts;
      const frame = mapFrameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      pinchStateRef.current = {
        startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        startZoom: zoom,
        startOffset: mapOffset,
        startMidX: (p1.x + p2.x) / 2 - rect.left,
        startMidY: (p1.y + p2.y) / 2 - rect.top,
      };
    }
  }

  function onMapPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!mapPointersRef.current.has(e.pointerId)) return;
    mapPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const frame = mapFrameRef.current;
    if (!frame) return;
    const containerW = frame.clientWidth;

    if (mapPointersRef.current.size === 1 && dragRef.current) {
      const displayW = containerW * zoom;
      const displayH = displayW * mapNaturalAspect;
      setMapOffset({
        x: clamp(dragRef.current.origin.x + e.clientX - dragRef.current.startX, -displayW / 2, displayW / 2),
        y: clamp(dragRef.current.origin.y + e.clientY - dragRef.current.startY, -displayH / 2, displayH / 2),
      });
    } else if (mapPointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = [...mapPointersRef.current.values()];
      const [p1, p2] = pts;
      const rect = frame.getBoundingClientRect();
      const { startDist, startZoom, startOffset, startMidX, startMidY } = pinchStateRef.current;

      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const newZoom = Math.max(0.8, Math.min(5.0, startZoom * currentDist / startDist));
      const ratio = newZoom / startZoom;

      // Keep the pinch anchor (start midpoint) fixed in geographic space
      const currentMidX = (p1.x + p2.x) / 2 - rect.left;
      const currentMidY = (p1.y + p2.y) / 2 - rect.top;
      const newOffsetX = currentMidX - containerW / 2 - (startMidX - containerW / 2 - startOffset.x) * ratio;
      const containerH = frame.clientHeight;
      const newOffsetY = currentMidY - containerH / 2 - (startMidY - containerH / 2 - startOffset.y) * ratio;

      const displayW = containerW * newZoom;
      const displayH = displayW * mapNaturalAspect;
      setZoom(newZoom);
      setMapOffset({
        x: clamp(newOffsetX, -displayW / 2, displayW / 2),
        y: clamp(newOffsetY, -displayH / 2, displayH / 2),
      });
    }
  }

  function onMapPointerUp(e: PointerEvent<HTMLDivElement>) {
    mapPointersRef.current.delete(e.pointerId);
    dragRef.current = null;
    pinchStateRef.current = null;
  }

  return (
    <main className="min-h-screen px-4 py-5">
      <section className="mx-auto flex w-full max-w-md flex-col gap-4">

        <header className="rounded-lg border-2 border-[var(--line)] bg-[var(--panel)] p-4 shadow-[5px_5px_0_var(--line)]">
          <p className="display-font text-sm tracking-wide text-[var(--accent-strong)]">
            HCD CAPTURE HUB
          </p>
          <h1 className="mt-1 text-3xl leading-tight">付箋を撮って送る</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            送信完了番号が出たら次へ進めます。
          </p>
        </header>

        {operatorName && !operatorEditMode ? (
          <section className="rounded-md border-2 border-[var(--line)] bg-[#fff7d1] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[var(--muted)]">スタッフ担当者名</p>
                <p className="mt-0.5 text-lg">{operatorName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOperatorEditMode(true)}
                className="rounded-md border-2 border-[var(--line)] bg-white px-3 py-1 text-sm"
              >
                変更
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-md border-2 border-[var(--line)] bg-[var(--panel-strong)] p-3">
            <label className="grid gap-1 text-sm">
              担当者名
              <input
                className={fieldBase}
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="例: 山田"
              />
            </label>
            <button
              type="button"
              className="mt-2 w-full rounded-md border-2 border-[var(--line)] bg-[var(--accent)] px-4 py-2"
              onClick={() => {
                localStorage.setItem("hcd.operatorName", operatorName);
                setOperatorEditMode(false);
              }}
            >
              保存して閉じる
            </button>
          </section>
        )}

        <section className="grid gap-3">
          <div
            ref={cameraFrameRef}
            className="relative overflow-hidden rounded-md border-2 border-[var(--line)] bg-black"
          >
            {/* Preview: shown over camera when photo is taken */}
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="送信前の付箋画像"
                className="aspect-[5/3] w-full object-cover"
              />
            )}
            {/* Camera: always mounted so srcObject persists across retake */}
            <div className={previewUrl ? "hidden" : "block"}>
              <video
                ref={videoRef}
                className={`aspect-[5/3] w-full object-cover ${
                  cameraState === "ready" ? "block" : "hidden"
                }`}
                playsInline
                muted
                autoPlay
              />
              {cameraState === "ready" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="absolute inset-0 bg-black/30" />
                  <div
                    ref={guideRef}
                    className="relative aspect-[5/3] w-[88%] border-2 border-[var(--accent)] shadow-[0_0_0_9999px_rgba(0,0,0,0.30)]"
                  >
                    <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/30" />
                    <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/30" />
                    <div className="absolute -left-px -top-px h-6 w-6 border-l-2 border-t-2 border-white/90" />
                    <div className="absolute -right-px -top-px h-6 w-6 border-r-2 border-t-2 border-white/90" />
                    <div className="absolute -bottom-px -left-px h-6 w-6 border-b-2 border-l-2 border-white/90" />
                    <div className="absolute -bottom-px -right-px h-6 w-6 border-b-2 border-r-2 border-white/90" />
                  </div>
                </div>
              )}
              {cameraState !== "ready" && (
                <div className="flex aspect-[5/3] flex-col items-center justify-center gap-3 bg-[#101820] p-6 text-center text-white">
                  <span className="display-font text-4xl">CAMERA</span>
                  <span className="text-sm text-white/70">
                    Webサイト内でカメラを起動して、付箋を撮影します。
                  </span>
                </div>
              )}
            </div>
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {previewUrl ? (
            <div className="grid grid-cols-2 items-stretch gap-3">
              <label className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-md border-2 border-[var(--line)] bg-white active:translate-y-0.5">
                画像を選ぶ
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    onFileChange(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="min-h-[72px] rounded-full border-2 border-[var(--line)] bg-white px-4 py-2 text-base shadow-[3px_3px_0_var(--line)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--line)]"
                onClick={() => onFileChange(null)}
              >
                撮り直す
              </button>
            </div>
          ) : cameraState === "ready" ? (
            <div className="grid gap-2">
              <button
                type="button"
                className="min-h-[88px] w-full rounded-full border-2 border-[var(--line)] bg-[var(--accent)] px-4 py-2 text-xl shadow-[3px_3px_0_var(--line)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--line)]"
                onClick={captureFromCamera}
              >
                シャッター
              </button>
              <label className="cursor-pointer text-center text-xs text-[var(--muted)]">
                または&nbsp;
                <span className="underline">画像を選ぶ</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    onFileChange(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-2 items-stretch gap-3">
              <label className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-md border-2 border-[var(--line)] bg-white active:translate-y-0.5">
                画像を選ぶ
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    onFileChange(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                disabled={cameraState === "starting"}
                className="min-h-[72px] rounded-full border-2 border-[var(--line)] bg-[var(--accent)] px-4 py-2 text-base shadow-[3px_3px_0_var(--line)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--line)] disabled:opacity-50"
                onClick={startCamera}
              >
                {cameraState === "starting" ? "起動中..." : "カメラ起動"}
              </button>
            </div>
          )}

          {cameraError && (
            <p className="rounded-md border-2 border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)]">
              {cameraError}
            </p>
          )}
        </section>

        <section className="grid gap-3">
          <div>
            <h3 className="text-base">年代・緯度経度指定</h3>
            <span className="mt-1 inline-block rounded-md border-2 border-[var(--line)] bg-white px-2 py-1 text-xs">
              {selectedEra} / {formatLatLng(previewLatLng)}
            </span>
          </div>

          <div className="grid gap-0">
            <div className="grid grid-cols-5 gap-0 px-0">
              {eras.map((era) => (
                <button
                  key={era}
                  aria-pressed={selectedEra === era}
                  className={`min-h-10 rounded-t-md border-2 border-b-0 border-[var(--line)] px-1 text-sm active:translate-y-0.5 ${
                    selectedEra === era
                      ? "bg-[var(--ink)] font-bold text-white"
                      : "bg-white"
                  }`}
                  onPointerDown={() => setSelectedEra(era)}
                  onClick={() => setSelectedEra(era)}
                  type="button"
                >
                  {era}
                </button>
              ))}
            </div>

            <div
              ref={setMapFrameRefs}
              className="relative aspect-[3/2] touch-none overflow-hidden rounded-md rounded-t-none border-2 border-[var(--line)] bg-[#101820]"
              onPointerCancel={onMapPointerUp}
              onPointerDown={onMapPointerDown}
              onPointerMove={onMapPointerMove}
              onPointerUp={onMapPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={mapImageRef}
                src={ERA_MAP_IMAGES[selectedEra]}
                alt={`${selectedEra}年代地図`}
                className="absolute max-w-none select-none"
                style={{
                  width: `${zoom * 100}%`,
                  top: "50%",
                  left: "50%",
                  transform: `translate(calc(-50% + ${mapOffset.x}px), calc(-50% + ${mapOffset.y}px))`,
                }}
                onLoad={handleMapImageLoad}
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_15px,rgba(16,24,32,0.10)_16px,transparent_17px)]" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2">
                <div className="absolute left-1/2 top-0 h-5 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_3px_rgba(0,0,0,0.9)]" />
                <div className="absolute bottom-0 left-1/2 h-5 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_3px_rgba(0,0,0,0.9)]" />
                <div className="absolute left-0 top-1/2 h-[2px] w-5 -translate-y-1/2 bg-white shadow-[0_0_3px_rgba(0,0,0,0.9)]" />
                <div className="absolute right-0 top-1/2 h-[2px] w-5 -translate-y-1/2 bg-white shadow-[0_0_3px_rgba(0,0,0,0.9)]" />
                <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent-strong)] shadow-[0_0_4px_rgba(0,0,0,0.9)]" />
              </div>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border-2 border-[var(--line)] bg-white/90 px-2 py-1 text-[11px]">
                {formatLatLng(previewLatLng)}
              </div>
            </div>
          </div>

          <p className="text-xs text-[var(--muted)]">
            ドラッグで移動、ピンチ/ホイールでズーム。中心の座標が自動で反映されます。
          </p>
        </section>

        <label className="grid gap-1 text-sm">
          書いた人の名前
          <input
            className={fieldBase}
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
            placeholder="例: 佐藤 / ニックネーム可"
          />
        </label>

        <div className="grid gap-2">
          <p className="text-sm">ジャンル</p>
          <div className="grid grid-cols-3 gap-2">
            {genres.map((g) => {
              const color = GENRE_COLORS[g] ?? { bg: "#ffffff", fg: "#192024" };
              const active = selectedGenre === g;
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={active}
                  className={`relative min-h-12 rounded-md border-2 border-[var(--line)] px-2 py-2 text-sm active:translate-y-0.5 ${
                    active ? "font-bold" : ""
                  }`}
                  style={{
                    backgroundColor: color.bg,
                    color: color.fg,
                    boxShadow: active ? "0 0 0 3px var(--line)" : "none"
                  }}
                  onPointerDown={() => setSelectedGenre(g)}
                  onClick={() => setSelectedGenre(g)}
                >
                  {active && (
                    <span className="absolute right-1 top-0.5 text-xs leading-none">✓</span>
                  )}
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-sm">大学内 / 大学外</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "inside", label: "大学内" },
              { value: "outside", label: "大学外" }
            ] as Array<{ value: Campus; label: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={selectedCampus === option.value}
                className={`min-h-12 rounded-md border-2 border-[var(--line)] px-2 py-2 text-sm active:translate-y-0.5 ${
                  selectedCampus === option.value ? "bg-[var(--accent)]" : "bg-white"
                }`}
                onClick={() =>
                  setSelectedCampus((current) =>
                    current === option.value ? "unknown" : option.value
                  )
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {state === "sent" ? (
          <footer className="sticky bottom-3 z-10 rounded-lg border-2 border-[var(--accent)] bg-[var(--ink)] p-4 text-white shadow-[5px_5px_0_rgba(0,0,0,0.25)]">
            <div className="text-center">
              <p className="text-sm opacity-70">送信完了</p>
              <p className="display-font mt-1 text-3xl">{lastResult?.id}</p>
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-md bg-[var(--accent)] px-4 py-4 text-xl text-[var(--ink)]"
              onClick={handleNextNote}
            >
              次の付箋へ →
            </button>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span>送信済み</span>
              <span className="display-font text-2xl">{sentCount}</span>
            </div>
          </footer>
        ) : (
          <footer className="sticky bottom-3 z-10 rounded-lg border-2 border-[var(--line)] bg-[var(--ink)] p-3 text-white shadow-[5px_5px_0_rgba(0,0,0,0.25)]">
            <button
              className="w-full rounded-md bg-[var(--accent)] px-4 py-4 text-xl text-[var(--ink)] disabled:opacity-50"
              disabled={!canSend}
              onClick={upload}
            >
              {state === "sending" ? "送信中..." : "サーバーに送信"}
            </button>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span>送信済み</span>
              <span className="display-font text-2xl">{sentCount}</span>
            </div>
            {error && <p className="mt-2 text-sm text-[#ffb6a6]">{error}</p>}
          </footer>
        )}

      </section>
    </main>
  );
}

function readLocalStorage(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }
  return window.localStorage.getItem(key) || fallback;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function getObjectCoverSourceRect(
  video: HTMLVideoElement,
  frame: HTMLElement,
  guide: HTMLElement
): CropRect | null {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (videoWidth <= 0 || videoHeight <= 0) return null;

  const frameRect = frame.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) return null;

  const scale = Math.max(
    frameRect.width / videoWidth,
    frameRect.height / videoHeight
  );
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (frameRect.width - renderedWidth) / 2;
  const offsetY = (frameRect.height - renderedHeight) / 2;

  const guideX = guideRect.left - frameRect.left;
  const guideY = guideRect.top - frameRect.top;

  const rawX = (guideX - offsetX) / scale;
  const rawY = (guideY - offsetY) / scale;
  const rawWidth = guideRect.width / scale;
  const rawHeight = guideRect.height / scale;

  const x = clamp(rawX, 0, videoWidth);
  const y = clamp(rawY, 0, videoHeight);
  const width = clamp(rawWidth, 1, videoWidth - x);
  const height = clamp(rawHeight, 1, videoHeight - y);

  return roundRect({ x, y, width, height });
}

function rectFromElements(frame: HTMLElement, guide: HTMLElement): CropRect {
  const frameRect = frame.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  return roundRect({
    x: guideRect.left - frameRect.left,
    y: guideRect.top - frameRect.top,
    width: guideRect.width,
    height: guideRect.height
  });
}

function roundRect(rect: CropRect): CropRect {
  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}


function computeLatLng(
  offset: MapOffset,
  frame: HTMLDivElement | null,
  zoom: number,
  naturalAspect: number
): LatLng {
  if (!frame) return { lat: MAP_BOUNDS.topLat, lng: MAP_BOUNDS.leftLng };
  const containerW = frame.clientWidth;
  const displayW = containerW * zoom;
  const displayH = displayW * naturalAspect;
  // Crosshair is at container center. normalizedX/Y = position in image (0=left/top, 1=right/bottom)
  const normalizedX = 0.5 - offset.x / displayW;
  const normalizedY = 0.5 - offset.y / displayH;
  return {
    lat: roundCoordinate(MAP_BOUNDS.topLat - normalizedY * (MAP_BOUNDS.topLat - MAP_BOUNDS.bottomLat)),
    lng: roundCoordinate(MAP_BOUNDS.leftLng + normalizedX * (MAP_BOUNDS.rightLng - MAP_BOUNDS.leftLng)),
  };
}

function formatLatLng(latLng: LatLng) {
  return `${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`;
}

function roundCoordinate(value: number) {
  return Math.round(value * 1000000) / 1000000;
}

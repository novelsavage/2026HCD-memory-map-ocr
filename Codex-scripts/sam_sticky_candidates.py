from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
from ultralytics import FastSAM


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def read_image(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image: {path}")
    return image


def write_jpg(path: Path, image: np.ndarray, quality: int = 92) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])[1].tofile(str(path))


def resize_max(image: np.ndarray, max_side: int) -> np.ndarray:
    h, w = image.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale >= 1:
        return image
    return cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def order_points(points: np.ndarray) -> np.ndarray:
    pts = points.reshape(4, 2).astype("float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    ordered = np.zeros((4, 2), dtype="float32")
    ordered[0] = pts[np.argmin(s)]
    ordered[2] = pts[np.argmax(s)]
    ordered[1] = pts[np.argmin(diff)]
    ordered[3] = pts[np.argmax(diff)]
    return ordered


def warp_box(image: np.ndarray, box: np.ndarray, padding_ratio: float) -> np.ndarray:
    rect = order_points(box)
    width = int(max(np.linalg.norm(rect[2] - rect[3]), np.linalg.norm(rect[1] - rect[0])))
    height = int(max(np.linalg.norm(rect[1] - rect[2]), np.linalg.norm(rect[0] - rect[3])))
    width = max(width, 1)
    height = max(height, 1)
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, dst)
    crop = cv2.warpPerspective(image, matrix, (width, height))
    pad = max(4, int(max(width, height) * padding_ratio))
    return cv2.copyMakeBorder(crop, pad, pad, pad, pad, cv2.BORDER_REPLICATE)


def approximate_polygon(contour: np.ndarray) -> list[list[int]]:
    perimeter = cv2.arcLength(contour, True)
    epsilon = max(2.0, perimeter * 0.012)
    polygon = cv2.approxPolyDP(contour, epsilon, True)
    return [[int(point[0][0]), int(point[0][1])] for point in polygon]


def raw_polygon(contour: np.ndarray) -> list[list[int]]:
    return [[int(point[0][0]), int(point[0][1])] for point in contour]


def edge_density(image: np.ndarray, mask: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 160)
    selected = mask > 0
    if not np.any(selected):
        return 1.0
    return float(np.count_nonzero(edges[selected])) / float(np.count_nonzero(selected))


def mask_to_candidate(image: np.ndarray, mask: np.ndarray, index: int) -> dict | None:
    h, w = image.shape[:2]
    area = int(np.count_nonzero(mask))
    image_area = h * w
    if area < image_area * 0.0015 or area > image_area * 0.35:
        return None

    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    polygon = approximate_polygon(contour)
    raw_points = raw_polygon(contour)
    x, y, bw, bh = cv2.boundingRect(contour)
    if bw < w * 0.035 or bh < h * 0.025:
        return None

    rect = cv2.minAreaRect(contour)
    (cx, cy), (rw, rh), angle = rect
    if rw <= 1 or rh <= 1:
        return None
    box = cv2.boxPoints(rect)
    box_i = np.int32(np.round(box))

    aspect = max(rw / max(rh, 1.0), rh / max(rw, 1.0))
    if aspect > 6.0:
        return None

    rect_area = max(1.0, rw * rh)
    rectangularity = min(1.0, area / rect_area)
    bbox_area = max(1, bw * bh)
    extent = area / bbox_area

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    selected = mask > 0
    mean_hsv = [float(v) for v in cv2.mean(hsv, mask=mask.astype(np.uint8))[:3]]
    mean_bgr = [float(v) for v in cv2.mean(image, mask=mask.astype(np.uint8))[:3]]
    mean_s = mean_hsv[1]
    mean_v = mean_hsv[2]
    pastel_score = 1.0 - min(1.0, abs(mean_s - 55.0) / 90.0)
    brightness_score = min(1.0, max(0.0, (mean_v - 75.0) / 115.0))

    ed = edge_density(image, mask.astype(np.uint8))
    texture_score = 1.0 - min(1.0, ed * 5.0)

    edge_margin = min(x, y, w - (x + bw), h - (y + bh))
    edge_bonus = max(0.0, min(1.0, edge_margin / (min(w, h) * 0.04)))
    size_score = min(1.0, math.sqrt(area / (image_area * 0.025)))

    score = (
        0.28 * rectangularity
        + 0.18 * min(1.0, extent)
        + 0.16 * pastel_score
        + 0.13 * brightness_score
        + 0.12 * texture_score
        + 0.08 * size_score
        + 0.05 * edge_bonus
    )

    return {
        "mask_index": index,
        "score": round(float(score), 4),
        "bbox": [int(x), int(y), int(bw), int(bh)],
        "box": [[int(px), int(py)] for px, py in box_i],
        "polygon": polygon,
        "raw_polygon": raw_points,
        "raw_polygon_point_count": len(raw_points),
        "area": int(area),
        "extent": round(float(extent), 4),
        "rectangularity": round(float(rectangularity), 4),
        "aspect": round(float(aspect), 4),
        "edge_density": round(float(ed), 4),
        "mean_hsv": [round(v, 2) for v in mean_hsv],
        "mean_bgr": [round(v, 2) for v in mean_bgr],
        "angle": round(float(angle), 2),
    }


def draw_preview(image: np.ndarray, candidates: list[dict]) -> np.ndarray:
    preview = image.copy()
    for i, candidate in enumerate(candidates):
        color = (0, 210, 255) if i == 0 else (60, 190, 80)
        box = np.array(candidate["box"], dtype=np.int32)
        cv2.polylines(preview, [box], True, color, 6)
        polygon = np.array(candidate["polygon"], dtype=np.int32)
        if len(polygon) >= 3:
            cv2.polylines(preview, [polygon], True, (255, 80, 80), 3)
        x, y, _, _ = candidate["bbox"]
        label = f"#{i} {candidate['score']:.2f}"
        cv2.rectangle(preview, (x, max(0, y - 48)), (x + 190, y), color, -1)
        cv2.putText(preview, label, (x + 8, max(28, y - 14)), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2, cv2.LINE_AA)
    return preview


def draw_raw_polygon_overlay(image: np.ndarray, candidate: dict) -> np.ndarray:
    overlay = image.copy()
    raw_points = np.array(candidate["raw_polygon"], dtype=np.int32)
    if len(raw_points) >= 3:
        cv2.polylines(overlay, [raw_points], True, (255, 80, 80), 5)

    box = np.array(candidate["box"], dtype=np.int32)
    cv2.polylines(overlay, [box], True, (0, 210, 255), 4)

    x, y, _, _ = candidate["bbox"]
    label = f"raw #{candidate.get('mask_index', '?')} pts={candidate['raw_polygon_point_count']}"
    cv2.rectangle(overlay, (x, max(0, y - 48)), (x + 360, y), (255, 80, 80), -1)
    cv2.putText(overlay, label, (x + 8, max(28, y - 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    return overlay


def crop_bbox_with_margin(image: np.ndarray, bbox: list[int], margin_ratio: float = 0.08) -> np.ndarray:
    x, y, w, h = bbox
    margin = int(max(w, h) * margin_ratio)
    x0 = max(0, x - margin)
    y0 = max(0, y - margin)
    x1 = min(image.shape[1], x + w + margin)
    y1 = min(image.shape[0], y + h + margin)
    return image[y0:y1, x0:x1]


def process_image(model: FastSAM, path: Path, output_dir: Path, args: argparse.Namespace) -> dict:
    image = read_image(path)
    t0 = time.perf_counter()
    results = model.predict(
        str(path),
        device=args.device,
        imgsz=args.imgsz,
        conf=args.conf,
        iou=args.iou,
        retina_masks=True,
        verbose=False,
    )
    elapsed = time.perf_counter() - t0

    masks = results[0].masks
    candidates: list[dict] = []
    if masks is not None:
        mask_data = masks.data.detach().cpu().numpy()
        for index, raw in enumerate(mask_data):
            mask = (raw > 0.5).astype(np.uint8) * 255
            if mask.shape[:2] != image.shape[:2]:
                mask = cv2.resize(mask, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
            candidate = mask_to_candidate(image, mask, index)
            if candidate is not None:
                candidates.append(candidate)

    candidates.sort(key=lambda item: item["score"], reverse=True)
    candidates = candidates[: args.max_candidates]

    item_dir = output_dir / path.stem
    item_dir.mkdir(parents=True, exist_ok=True)
    preview = resize_max(draw_preview(image, candidates), args.preview_side)
    write_jpg(item_dir / "preview_sam_candidates.jpg", preview)

    for i, candidate in enumerate(candidates):
        box = np.array(candidate["box"], dtype=np.float32)
        crop = warp_box(image, box, args.padding_ratio)
        write_jpg(item_dir / f"sam_crop_{i:02d}.jpg", crop, quality=94)
        write_jpg(item_dir / f"rectified_{i:02d}.jpg", crop, quality=94)
        raw_overlay = draw_raw_polygon_overlay(image, candidate)
        write_jpg(item_dir / f"raw_polygon_{i:02d}_full.jpg", resize_max(raw_overlay, args.preview_side), quality=92)
        raw_overlay_crop = crop_bbox_with_margin(raw_overlay, candidate["bbox"])
        write_jpg(item_dir / f"raw_polygon_{i:02d}.jpg", raw_overlay_crop, quality=94)

    result = {
        "source": str(path),
        "image_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "elapsed_sec": round(elapsed, 3),
        "raw_mask_count": 0 if masks is None else int(len(masks)),
        "candidate_count": len(candidates),
        "candidates": candidates,
    }
    (item_dir / "sam_candidates.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def iter_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(
        p
        for p in input_path.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and not p.name.startswith("preview_")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate sticky-note crop candidates with FastSAM.")
    parser.add_argument("input", type=Path, help="Input image file or directory.")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output directory. Defaults to <input>/sam-preview.")
    parser.add_argument("--model", default="outputs/models/FastSAM-s.pt", help="FastSAM checkpoint path/name.")
    parser.add_argument("--device", default=0, help="CUDA device id or 'cpu'.")
    parser.add_argument("--imgsz", type=int, default=1024)
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--iou", type=float, default=0.8)
    parser.add_argument("--max-candidates", type=int, default=8)
    parser.add_argument("--preview-side", type=int, default=1400)
    parser.add_argument("--padding-ratio", type=float, default=0.035)
    args = parser.parse_args()

    input_path = args.input
    output_dir = args.output or (input_path if input_path.is_dir() else input_path.parent) / "sam-preview"
    output_dir.mkdir(parents=True, exist_ok=True)

    model = FastSAM(args.model)
    results = []
    for path in iter_images(input_path):
        result = process_image(model, path, output_dir, args)
        results.append(result)
        print(f"{path.name}: raw_masks={result['raw_mask_count']} candidates={result['candidate_count']} elapsed={result['elapsed_sec']}s")

    summary = {
        "input": str(input_path),
        "output": str(output_dir),
        "model": args.model,
        "device": args.device,
        "imgsz": args.imgsz,
        "image_count": len(results),
        "total_candidates": sum(item["candidate_count"] for item in results),
        "results": results,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {output_dir / 'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

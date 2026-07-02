from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def resize_for_detection(image: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    long_side = max(height, width)
    if long_side <= max_side:
        return image.copy(), 1.0
    scale = max_side / long_side
    resized = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def build_sticky_mask(image: np.ndarray) -> np.ndarray:
    blurred = cv2.bilateralFilter(image, 7, 60, 60)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    bright = v >= 105
    pastel = (s >= 22) & (s <= 150)

    yellow = (h >= 12) & (h <= 48)
    green = (h >= 45) & (h <= 92)
    cyan_blue = (h >= 88) & (h <= 116)
    pink = (h >= 145) | (h <= 8)

    color_mask = bright & pastel & (yellow | green | cyan_blue | pink)

    gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.magnitude(grad_x, grad_y)
    grad = cv2.blur(grad, (15, 15))
    smooth_paper = (grad <= 24) & (v >= 95) & (s <= 105)

    mask = np.where(color_mask | smooth_paper, 255, 0).astype(np.uint8)

    short_side = min(image.shape[:2])
    close_size = max(9, int(short_side * 0.018) | 1)
    open_size = max(5, int(short_side * 0.006) | 1)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (close_size, close_size))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (open_size, open_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
    return mask


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


def warp_candidate(image: np.ndarray, box: np.ndarray, padding_ratio: float) -> np.ndarray:
    rect = order_points(box)
    width_a = np.linalg.norm(rect[2] - rect[3])
    width_b = np.linalg.norm(rect[1] - rect[0])
    height_a = np.linalg.norm(rect[1] - rect[2])
    height_b = np.linalg.norm(rect[0] - rect[3])
    width = max(1, int(max(width_a, width_b)))
    height = max(1, int(max(height_a, height_b)))

    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, matrix, (width, height))
    if padding_ratio <= 0:
        return warped

    pad = max(4, int(max(width, height) * padding_ratio))
    return cv2.copyMakeBorder(warped, pad, pad, pad, pad, cv2.BORDER_REPLICATE)


def edge_density(gray_crop: np.ndarray) -> float:
    if gray_crop.size == 0:
        return 1.0
    small = cv2.resize(gray_crop, (min(260, gray_crop.shape[1]), min(260, gray_crop.shape[0])), interpolation=cv2.INTER_AREA)
    edges = cv2.Canny(small, 60, 160)
    return float(np.count_nonzero(edges)) / float(edges.size)


def detect_candidates(image: np.ndarray, mask: np.ndarray, max_candidates: int) -> list[dict]:
    height, width = image.shape[:2]
    image_area = height * width
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[dict] = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.002 or area > image_area * 0.45:
            continue

        x, y, w, h = cv2.boundingRect(contour)
        if w < width * 0.04 or h < height * 0.025:
            continue

        bbox_area = max(1, w * h)
        extent = area / bbox_area
        aspect = max(w / max(1, h), h / max(1, w))
        if extent < 0.30 or aspect > 5.2:
            continue

        rect = cv2.minAreaRect(contour)
        (cx, cy), (rw, rh), angle = rect
        if rw <= 1 or rh <= 1:
            continue

        rect_area = rw * rh
        rectangularity = min(1.0, area / max(1.0, rect_area))
        box = cv2.boxPoints(rect)
        box = np.int32(np.round(box))

        roi_mask = mask[y : y + h, x : x + w]
        mask_coverage = float(np.count_nonzero(roi_mask)) / float(bbox_area)
        gray = cv2.cvtColor(image[y : y + h, x : x + w], cv2.COLOR_BGR2GRAY)
        texture_penalty = edge_density(gray)

        edge_margin = min(x, y, width - (x + w), height - (y + h))
        edge_bonus = max(0.0, min(1.0, edge_margin / (min(width, height) * 0.04)))

        size_score = min(1.0, math.sqrt(area / (image_area * 0.035)))
        score = (
            0.28 * min(1.0, extent)
            + 0.25 * rectangularity
            + 0.18 * min(1.0, mask_coverage)
            + 0.16 * size_score
            + 0.08 * edge_bonus
            - 0.20 * min(1.0, texture_penalty * 4.0)
        )

        candidates.append(
            {
                "score": round(float(score), 4),
                "bbox": [int(x), int(y), int(w), int(h)],
                "box": [[int(px), int(py)] for px, py in box],
                "area": round(float(area), 1),
                "extent": round(float(extent), 4),
                "rectangularity": round(float(rectangularity), 4),
                "mask_coverage": round(float(mask_coverage), 4),
                "edge_density": round(float(texture_penalty), 4),
                "angle": round(float(angle), 2),
            }
        )

    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates[:max_candidates]


def scale_candidate(candidate: dict, inv_scale: float) -> dict:
    scaled = dict(candidate)
    scaled["bbox"] = [int(round(v * inv_scale)) for v in candidate["bbox"]]
    scaled["box"] = [[int(round(px * inv_scale)), int(round(py * inv_scale))] for px, py in candidate["box"]]
    scaled["area"] = round(float(candidate["area"]) * inv_scale * inv_scale, 1)
    return scaled


def draw_preview(image: np.ndarray, candidates: list[dict]) -> np.ndarray:
    preview = image.copy()
    for index, candidate in enumerate(candidates):
        color = (0, 210, 255) if index == 0 else (60, 190, 80)
        box = np.array(candidate["box"], dtype=np.int32)
        cv2.polylines(preview, [box], True, color, 5)
        x, y, w, h = candidate["bbox"]
        label = f"#{index} {candidate['score']:.2f}"
        cv2.rectangle(preview, (x, y - 42), (x + 170, y), color, -1)
        cv2.putText(preview, label, (x + 8, y - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2, cv2.LINE_AA)
    return preview


def process_image(path: Path, output_dir: Path, args: argparse.Namespace) -> dict:
    image = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image: {path}")

    detect_image, scale = resize_for_detection(image, args.max_side)
    mask_small = build_sticky_mask(detect_image)
    candidates_small = detect_candidates(detect_image, mask_small, args.max_candidates)
    inv_scale = 1.0 / scale
    candidates = [scale_candidate(candidate, inv_scale) for candidate in candidates_small]

    item_dir = output_dir / path.stem
    item_dir.mkdir(parents=True, exist_ok=True)

    mask_full = cv2.resize(mask_small, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
    cv2.imencode(".jpg", mask_full)[1].tofile(str(item_dir / "debug_mask.jpg"))

    preview = draw_preview(image, candidates)
    preview_small, _ = resize_for_detection(preview, args.preview_side)
    cv2.imencode(".jpg", preview_small, [int(cv2.IMWRITE_JPEG_QUALITY), 90])[1].tofile(str(item_dir / "preview_candidates.jpg"))

    for index, candidate in enumerate(candidates):
        box = np.array(candidate["box"], dtype=np.float32)
        crop = warp_candidate(image, box, args.padding_ratio)
        cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 94])[1].tofile(str(item_dir / f"crop_{index:02d}.jpg"))

    result = {
        "source": str(path),
        "image_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "candidate_count": len(candidates),
        "candidates": candidates,
        "fallback_used": len(candidates) == 0,
    }
    (item_dir / "candidates.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def iter_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(
        path
        for path in input_path.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and not path.name.startswith("preview_")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect and crop sticky-note candidates from camera images.")
    parser.add_argument("input", type=Path, help="Input image file or directory.")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output directory. Defaults to <input>/crop-preview.")
    parser.add_argument("--max-side", type=int, default=1600, help="Max side length used for detection.")
    parser.add_argument("--preview-side", type=int, default=1400, help="Max side length for preview images.")
    parser.add_argument("--max-candidates", type=int, default=5, help="Maximum crop candidates per image.")
    parser.add_argument("--padding-ratio", type=float, default=0.035, help="Replicated border padding around warped crops.")
    args = parser.parse_args()

    input_path = args.input
    output_dir = args.output or (input_path if input_path.is_dir() else input_path.parent) / "crop-preview"
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for path in iter_images(input_path):
        result = process_image(path, output_dir, args)
        results.append(result)
        print(f"{path.name}: {result['candidate_count']} candidate(s)")

    summary = {
        "input": str(input_path),
        "output": str(output_dir),
        "image_count": len(results),
        "total_candidates": sum(item["candidate_count"] for item in results),
        "results": results,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {output_dir / 'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

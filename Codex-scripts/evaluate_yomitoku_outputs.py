from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate YomiToku JSON outputs.")
    parser.add_argument(
        "input",
        nargs="?",
        type=Path,
        default=Path("OCR用の画像"),
        help="Directory containing YomiToku JSON files. Default: OCR用の画像",
    )
    parser.add_argument(
        "--ground-truth",
        type=Path,
        default=Path("data/ground_truth"),
        help="Optional directory with <json-stem>.txt ground truth files.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("outputs/ocr-evaluation/yomitoku-evaluation.json"),
        help="JSON report output path.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not any(key in payload for key in ("words", "paragraphs", "figures", "tables")):
        return None
    return payload


def extract_text(payload: dict[str, Any]) -> str:
    blocks: list[tuple[int, str]] = []
    for paragraph in payload.get("paragraphs") or []:
        text = str(paragraph.get("contents") or "").strip()
        if text:
            blocks.append((int(paragraph.get("order") or len(blocks)), text))
    for figure in payload.get("figures") or []:
        figure_order = int(figure.get("order") or len(blocks))
        for paragraph in figure.get("paragraphs") or []:
            text = str(paragraph.get("contents") or "").strip()
            if text:
                blocks.append((figure_order * 1000 + int(paragraph.get("order") or 0), text))
    if not blocks:
        for index, word in enumerate(payload.get("words") or []):
            text = str(word.get("content") or "").strip()
            if text:
                blocks.append((index, text))
    return "\n".join(text for _, text in sorted(blocks, key=lambda item: item[0]))


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (0 if ca == cb else 1),
                )
            )
        previous = current
    return previous[-1]


def normalized_text(value: str) -> str:
    return "".join(value.split())


def find_ground_truth(ground_truth_dir: Path, json_path: Path) -> Path | None:
    candidates = [
        ground_truth_dir / f"{json_path.stem}.txt",
        ground_truth_dir / f"{json_path.stem.replace('_p1', '')}.txt",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def evaluate_file(path: Path, ground_truth_dir: Path) -> dict[str, Any] | None:
    payload = load_json(path)
    if payload is None:
        return None
    text = extract_text(payload)
    words = payload.get("words") or []
    rec_scores = [float(word["rec_score"]) for word in words if isinstance(word.get("rec_score"), (int, float))]
    det_scores = [float(word["det_score"]) for word in words if isinstance(word.get("det_score"), (int, float))]
    low_conf = [
        str(word.get("content") or "")
        for word in words
        if isinstance(word.get("rec_score"), (int, float)) and float(word["rec_score"]) < 0.7
    ]
    result: dict[str, Any] = {
        "jsonPath": str(path),
        "text": text,
        "charCount": len(normalized_text(text)),
        "wordCount": len(words),
        "avgRecScore": round(sum(rec_scores) / len(rec_scores), 4) if rec_scores else None,
        "avgDetScore": round(sum(det_scores) / len(det_scores), 4) if det_scores else None,
        "lowConfidenceWords": low_conf,
    }
    gt_path = find_ground_truth(ground_truth_dir, path)
    if gt_path:
        truth = gt_path.read_text(encoding="utf-8")
        distance = levenshtein(normalized_text(text), normalized_text(truth))
        denominator = max(1, len(normalized_text(truth)))
        result.update(
            {
                "groundTruthPath": str(gt_path),
                "cer": round(distance / denominator, 4),
                "editDistance": distance,
                "groundTruthCharCount": len(normalized_text(truth)),
            }
        )
    return result


def write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# YomiToku OCR evaluation",
        "",
        f"- generatedAt: {report['generatedAt']}",
        f"- input: {report['input']}",
        f"- jsonFiles: {report['jsonFiles']}",
        f"- filesWithText: {report['filesWithText']}",
        f"- totalChars: {report['totalChars']}",
        f"- avgRecScore: {report['avgRecScore']}",
        f"- avgDetScore: {report['avgDetScore']}",
        f"- groundTruthFiles: {report['groundTruthFiles']}",
        "",
    ]
    if report["groundTruthFiles"] == 0:
        lines.extend(
            [
                "Ground truth text files were not found, so this is a proxy evaluation.",
                "Use matching .txt files under data/ground_truth to calculate CER.",
                "",
            ]
        )
    lines.append("## Files")
    for item in report["files"]:
        preview = item["text"].replace("\n", " / ")[:120]
        lines.append(
            f"- `{Path(item['jsonPath']).name}` chars={item['charCount']} words={item['wordCount']} "
            f"rec={item['avgRecScore']} det={item['avgDetScore']} text={preview}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    files: list[dict[str, Any]] = []
    for path in sorted(args.input.rglob("*.json")):
        result = evaluate_file(path, args.ground_truth)
        if result:
            files.append(result)

    rec_scores = [float(item["avgRecScore"]) for item in files if item.get("avgRecScore") is not None]
    det_scores = [float(item["avgDetScore"]) for item in files if item.get("avgDetScore") is not None]
    report = {
        "generatedAt": utc_now(),
        "input": str(args.input),
        "groundTruth": str(args.ground_truth),
        "jsonFiles": len(files),
        "filesWithText": sum(1 for item in files if item["charCount"] > 0),
        "totalChars": sum(int(item["charCount"]) for item in files),
        "totalWords": sum(int(item["wordCount"]) for item in files),
        "avgRecScore": round(sum(rec_scores) / len(rec_scores), 4) if rec_scores else None,
        "avgDetScore": round(sum(det_scores) / len(det_scores), 4) if det_scores else None,
        "groundTruthFiles": sum(1 for item in files if item.get("groundTruthPath")),
        "files": files,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_markdown(report, args.out.with_suffix(".md"))
    print(f"wrote {args.out}")
    print(f"jsonFiles={report['jsonFiles']} filesWithText={report['filesWithText']} avgRecScore={report['avgRecScore']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

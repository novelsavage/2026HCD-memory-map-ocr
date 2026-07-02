from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run OCR for WebApp capture records and move them to pending_review."
    )
    parser.add_argument(
        "manifest",
        nargs="?",
        type=Path,
        default=Path("outputs/webapp-captures/reitaku-hcd-2026/manifest.json"),
        help="WebApp manifest path. Default: outputs/webapp-captures/reitaku-hcd-2026/manifest.json",
    )
    parser.add_argument("--id", dest="ids", action="append", help="Process only this record id. Can be repeated.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of records to process.")
    parser.add_argument("--force", action="store_true", help="Re-run OCR even when OCR already succeeded.")
    parser.add_argument("--dry-run", action="store_true", help="Print target records without changing files.")
    parser.add_argument("--watch", action="store_true", help="Keep polling records and OCR new captures.")
    parser.add_argument("--interval", type=float, default=1.0, help="Polling interval in seconds for --watch. Default: 1")
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="In --watch mode, retry ocr.failed records. Default is to leave failed records for manual rerun.",
    )
    parser.add_argument("--device", default="cuda", help="YomiToku device. Default: cuda")
    parser.add_argument("--no-lite", action="store_true", help="Do not pass --lite to YomiToku.")
    parser.add_argument("--no-vis", action="store_true", help="Do not generate YomiToku visualization images.")
    parser.add_argument(
        "--reading-order",
        choices=["auto", "top2bottom", "left2right", "right2left"],
        default=None,
        help="Override YomiToku reading order.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def record_path(base_dir: Path, record_id: str) -> Path:
    return base_dir / "records" / f"{record_id}.json"


def load_records(base_dir: Path) -> list[dict[str, Any]]:
    records_dir = base_dir / "records"
    if not records_dir.exists():
        raise FileNotFoundError(f"records directory does not exist: {records_dir}")
    records: list[dict[str, Any]] = []
    for path in sorted(records_dir.glob("*.json")):
        records.append(load_json(path))
    return records


def rebuild_manifest(base_dir: Path, manifest_path: Path) -> None:
    records = load_records(base_dir)
    records.sort(key=lambda item: str(item.get("capture", {}).get("receivedAt", "")), reverse=True)
    event_id = records[0].get("eventId") if records else "reitaku-hcd-2026"
    write_json(
        manifest_path,
        {
            "eventId": event_id,
            "generatedAt": utc_now(),
            "count": len(records),
            "records": records,
        },
    )


def select_input_image(base_dir: Path, record: dict[str, Any]) -> Path:
    capture = record.get("capture") or {}
    crop = capture.get("crop") or {}
    candidates = [
        crop.get("localImagePath"),
        capture.get("localImagePath"),
        crop.get("storedFileName") and str(Path("captures") / str(crop["storedFileName"])),
        capture.get("storedFileName") and str(Path("captures") / str(capture["storedFileName"])),
    ]
    for value in candidates:
        if not value:
            continue
        path = base_dir / Path(str(value))
        if path.exists() and path.suffix.lower() in IMAGE_SUFFIXES:
            return path
    raise FileNotFoundError(f"No OCR input image found for {record.get('id')}")


def should_process(record: dict[str, Any], args: argparse.Namespace, include_failed: bool = True) -> bool:
    if args.ids and record.get("id") not in set(args.ids):
        return False
    if args.force:
        return True
    if record.get("status") != "captured":
        return False
    ocr = record.get("ocr") or {}
    allowed = {None, "", "not_run"}
    if include_failed:
        allowed.add("failed")
    return ocr.get("status") in allowed


def relative_to_base(base_dir: Path, path: Path) -> str:
    try:
        return str(path.relative_to(base_dir))
    except ValueError:
        return str(path)


def set_ocr_state(
    base_dir: Path,
    manifest_path: Path,
    record: dict[str, Any],
    status: str,
    **updates: Any,
) -> dict[str, Any]:
    now = utc_now()
    next_record = dict(record)
    next_record["version"] = int(next_record.get("version") or 1) + 1
    next_record["updatedAt"] = now
    ocr = {
        "engine": "yomitoku",
        "status": status,
        "textRaw": "",
        "textReviewed": "",
        "ranAt": None,
        "inputImagePath": None,
        "overlayImagePath": None,
        "lastError": None,
    }
    ocr.update(record.get("ocr") or {})
    ocr.update(updates)
    ocr["status"] = status
    next_record["ocr"] = ocr
    if status == "succeeded" and record.get("status") != "published":
        next_record["status"] = "pending_review"
    write_json(record_path(base_dir, str(next_record["id"])), next_record)
    rebuild_manifest(base_dir, manifest_path)
    return next_record


def run_yomitoku(input_path: Path, out_dir: Path, args: argparse.Namespace) -> subprocess.CompletedProcess[str]:
    executable = shutil.which("yomitoku")
    if not executable:
        raise RuntimeError("yomitoku command was not found. Run this script with `uv run python ...`.")

    command = [
        executable,
        str(input_path),
        "-d",
        args.device,
        "-f",
        "json",
        "-o",
        str(out_dir),
    ]
    if not args.no_lite:
        command.append("--lite")
    if not args.no_vis:
        command.append("-v")
    if args.reading_order:
        command.extend(["--reading_order", args.reading_order])

    out_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    result = subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
        env=env,
    )
    (out_dir / "yomitoku.log").write_text(
        "COMMAND: "
        + " ".join(command)
        + "\n\nSTDOUT:\n"
        + (result.stdout or "")
        + "\n\nSTDERR:\n"
        + (result.stderr or ""),
        encoding="utf-8",
    )
    return result


def extract_text_from_yomitoku_json(path: Path) -> tuple[str, dict[str, Any]]:
    payload = load_json(path)
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
                order = figure_order * 1000 + int(paragraph.get("order") or 0)
                blocks.append((order, text))

    if not blocks:
        for index, word in enumerate(payload.get("words") or []):
            text = str(word.get("content") or "").strip()
            if text:
                blocks.append((index, text))

    ordered_text = "\n".join(text for _, text in sorted(blocks, key=lambda item: item[0]))
    words = payload.get("words") or []
    rec_scores = [float(word["rec_score"]) for word in words if isinstance(word.get("rec_score"), (int, float))]
    det_scores = [float(word["det_score"]) for word in words if isinstance(word.get("det_score"), (int, float))]
    metrics = {
        "jsonPath": str(path),
        "wordCount": len(words),
        "charCount": len(ordered_text.replace("\n", "")),
        "avgRecScore": round(sum(rec_scores) / len(rec_scores), 4) if rec_scores else None,
        "avgDetScore": round(sum(det_scores) / len(det_scores), 4) if det_scores else None,
    }
    return ordered_text, metrics


def collect_yomitoku_result(out_dir: Path) -> tuple[str, Path | None, dict[str, Any]]:
    json_files = sorted(path for path in out_dir.glob("*.json") if path.name != "summary.json")
    if not json_files:
        raise FileNotFoundError(f"YomiToku JSON output was not found under {out_dir}")
    texts: list[str] = []
    metrics_list: list[dict[str, Any]] = []
    for path in json_files:
        text, metrics = extract_text_from_yomitoku_json(path)
        if text:
            texts.append(text)
        metrics_list.append(metrics)
    overlay = next(iter(sorted(out_dir.glob("*_ocr.jpg"))), None)
    combined = "\n\n".join(texts).strip()
    metrics = {
        "files": metrics_list,
        "charCount": sum(int(item["charCount"]) for item in metrics_list),
        "wordCount": sum(int(item["wordCount"]) for item in metrics_list),
    }
    return combined, overlay, metrics


def process_record(base_dir: Path, manifest_path: Path, record: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    record_id = str(record["id"])
    input_path = select_input_image(base_dir, record)
    out_dir = base_dir / "ocr" / record_id
    set_ocr_state(
        base_dir,
        manifest_path,
        record,
        "running",
        ranAt=utc_now(),
        inputImagePath=relative_to_base(base_dir, input_path),
        overlayImagePath=None,
        lastError=None,
    )

    result = run_yomitoku(input_path, out_dir, args)
    latest = load_json(record_path(base_dir, record_id))
    if result.returncode != 0:
        error = (result.stderr or result.stdout or f"YomiToku failed with exit code {result.returncode}").strip()
        return set_ocr_state(
            base_dir,
            manifest_path,
            latest,
            "failed",
            ranAt=utc_now(),
            inputImagePath=relative_to_base(base_dir, input_path),
            lastError=error[-2000:],
        )

    text_raw, overlay, metrics = collect_yomitoku_result(out_dir)
    ocr = latest.get("ocr") or {}
    reviewed = str(ocr.get("textReviewed") or "").strip() or text_raw
    completed = set_ocr_state(
        base_dir,
        manifest_path,
        latest,
        "succeeded",
        textRaw=text_raw,
        textReviewed=reviewed,
        ranAt=utc_now(),
        inputImagePath=relative_to_base(base_dir, input_path),
        overlayImagePath=relative_to_base(base_dir, overlay) if overlay else None,
        lastError=None if text_raw else "OCR completed but no text was extracted.",
    )
    write_json(out_dir / "ocr_metrics.json", metrics)
    return completed


def select_targets(base_dir: Path, args: argparse.Namespace, include_failed: bool) -> list[dict[str, Any]]:
    records = load_records(base_dir)
    targets = [record for record in records if should_process(record, args, include_failed=include_failed)]
    if args.limit > 0:
        targets = targets[: args.limit]
    return targets


def run_once(base_dir: Path, manifest_path: Path, args: argparse.Namespace, include_failed: bool) -> tuple[int, int, int]:
    targets = select_targets(base_dir, args, include_failed=include_failed)
    print(f"base: {base_dir}")
    print(f"target records: {len(targets)}")
    for record in targets:
        print(f"- {record.get('id')} status={record.get('status')} ocr={((record.get('ocr') or {}).get('status'))}")

    if args.dry_run:
        return (0, 0, len(targets))

    ok = 0
    failed = 0
    for record in targets:
        record_id = record.get("id")
        try:
            completed = process_record(base_dir, manifest_path, record, args)
            status = (completed.get("ocr") or {}).get("status")
            print(f"{record_id}: {status}")
            ok += int(status == "succeeded")
            failed += int(status != "succeeded")
        except Exception as exc:
            failed += 1
            print(f"{record_id}: failed: {exc}", file=sys.stderr)
            try:
                set_ocr_state(
                    base_dir,
                    manifest_path,
                    record,
                    "failed",
                    ranAt=utc_now(),
                    lastError=str(exc)[-2000:],
                )
            except Exception:
                pass

    print(f"done: succeeded={ok} failed={failed}")
    return (ok, failed, len(targets))


def run_watch(base_dir: Path, manifest_path: Path, args: argparse.Namespace) -> int:
    print(f"watching: {base_dir / 'records'}")
    print(f"interval: {args.interval:g}s device={args.device}")
    print("Press Ctrl+C to stop.")
    loops = 0
    try:
        while True:
            loops += 1
            targets = select_targets(base_dir, args, include_failed=args.retry_failed)
            if targets:
                print(f"[{utc_now()}] found {len(targets)} target record(s)")
                ok, failed, _ = run_once(base_dir, manifest_path, args, include_failed=args.retry_failed)
                if failed:
                    print(f"[{utc_now()}] worker pass completed with failed={failed}", file=sys.stderr)
                else:
                    print(f"[{utc_now()}] worker pass completed with succeeded={ok}")
            elif loops == 1:
                print(f"[{utc_now()}] no target records")
            time.sleep(max(0.1, args.interval))
    except KeyboardInterrupt:
        print("\nstopped")
        return 0


def main() -> int:
    args = parse_args()
    if args.watch and args.force:
        print("--force cannot be used with --watch because it would re-run finished records every loop.", file=sys.stderr)
        return 2
    if args.interval <= 0:
        print("--interval must be greater than 0.", file=sys.stderr)
        return 2

    manifest_path = args.manifest.resolve()
    base_dir = manifest_path.parent
    if not manifest_path.exists():
        print(f"manifest does not exist: {manifest_path}", file=sys.stderr)
        return 2

    if args.watch:
        return run_watch(base_dir, manifest_path, args)

    _ok, failed, _targets = run_once(base_dir, manifest_path, args, include_failed=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

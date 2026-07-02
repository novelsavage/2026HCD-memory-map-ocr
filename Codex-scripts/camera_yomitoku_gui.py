from __future__ import annotations

import argparse
import queue
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cv2


WINDOW_NAME = "YomiToku Camera OCR"


@dataclass(frozen=True)
class OcrJob:
    image_path: Path
    outdir: Path
    device: str
    output_format: str
    figure: bool
    ignore_line_break: bool
    ignore_meta: bool


@dataclass
class OcrState:
    running: bool = False
    message: str = "Ready"
    last_image: Path | None = None
    last_outdir: Path | None = None
    last_returncode: int | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open a webcam preview and run YomiToku OCR on captured frames."
    )
    parser.add_argument(
        "--camera",
        type=int,
        default=0,
        help="OpenCV camera index. Default: 0",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1280,
        help="Requested camera width. Default: 1280",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=720,
        help="Requested camera height. Default: 720",
    )
    parser.add_argument(
        "--captures-dir",
        default="outputs/camera/captures",
        help="Directory for captured frame images.",
    )
    parser.add_argument(
        "--outdir",
        default="outputs/camera/yomitoku",
        help="Directory for YomiToku OCR outputs.",
    )
    parser.add_argument(
        "--device",
        default="cuda",
        help="YomiToku device. Default: cuda",
    )
    parser.add_argument(
        "-f",
        "--format",
        default="md",
        choices=["md", "json", "csv", "html", "pdf"],
        help="YomiToku output format. Default: md",
    )
    parser.add_argument(
        "--figure",
        action="store_true",
        help="Export detected figures/images.",
    )
    parser.add_argument(
        "--ignore-line-break",
        action="store_true",
        help="Join line breaks inside paragraphs.",
    )
    parser.add_argument(
        "--ignore-meta",
        action="store_true",
        help="Exclude headers, footers, and other metadata from output.",
    )
    return parser.parse_args()


def draw_overlay(frame, state: OcrState) -> None:
    height, width = frame.shape[:2]
    lines = [
        "Space/Enter: shutter + OCR   Q/Esc: quit",
        "YomiToku: --lite -d cuda",
        f"Status: {state.message}",
    ]
    if state.last_image:
        lines.append(f"Last capture: {state.last_image.name}")
    if state.last_outdir:
        lines.append(f"Output: {state.last_outdir}")

    line_height = 26
    box_height = line_height * len(lines) + 18
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (width, box_height), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.58, frame, 0.42, 0, frame)

    for index, line in enumerate(lines):
        y = 27 + index * line_height
        cv2.putText(
            frame,
            line,
            (14, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

    if state.running:
        radius = 8 + int(time.time() * 3) % 6
        cv2.circle(frame, (width - 28, 28), radius, (0, 210, 255), -1)


def build_yomitoku_command(job: OcrJob) -> list[str]:
    command = [
        "yomitoku",
        str(job.image_path),
        "--lite",
        "-d",
        job.device,
        "-f",
        job.output_format,
        "-o",
        str(job.outdir),
        "-v",
    ]
    if job.figure:
        command.append("--figure")
    if job.ignore_line_break:
        command.append("--ignore_line_break")
    if job.ignore_meta:
        command.append("--ignore_meta")
    return command


def worker(job_queue: queue.Queue[OcrJob | None], state: OcrState) -> None:
    while True:
        job = job_queue.get()
        if job is None:
            return

        state.running = True
        state.message = "OCR running"
        state.last_image = job.image_path
        state.last_outdir = job.outdir
        state.last_returncode = None

        command = build_yomitoku_command(job)
        try:
            result = subprocess.run(command, check=False)
            state.last_returncode = result.returncode
            if result.returncode == 0:
                state.message = "OCR complete"
            else:
                state.message = f"OCR failed: exit {result.returncode}"
        except FileNotFoundError:
            state.message = "yomitoku command not found. Run via uv run."
            state.last_returncode = 127
        finally:
            state.running = False


def make_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")


def save_capture(frame, captures_dir: Path) -> Path:
    captures_dir.mkdir(parents=True, exist_ok=True)
    image_path = captures_dir / f"capture_{make_timestamp()}.png"
    if not cv2.imwrite(str(image_path), frame):
        raise RuntimeError(f"Failed to save capture: {image_path}")
    return image_path


def main() -> int:
    args = parse_args()
    captures_dir = Path(args.captures_dir)
    base_outdir = Path(args.outdir)
    captures_dir.mkdir(parents=True, exist_ok=True)
    base_outdir.mkdir(parents=True, exist_ok=True)

    if shutil.which("yomitoku") is None:
        print("yomitoku command was not found. Run this script with `uv run python`.")
        return 127

    capture = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not capture.isOpened():
        capture = cv2.VideoCapture(args.camera)
    if not capture.isOpened():
        print(f"Failed to open camera index: {args.camera}")
        return 2

    capture.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    state = OcrState()
    job_queue: queue.Queue[OcrJob | None] = queue.Queue(maxsize=1)
    thread = threading.Thread(target=worker, args=(job_queue, state))
    thread.start()

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, args.width, args.height)

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                state.message = "Camera frame read failed"
                time.sleep(0.1)
                continue

            display = frame.copy()
            draw_overlay(display, state)
            cv2.imshow(WINDOW_NAME, display)

            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q"), ord("Q")):
                break
            if key in (13, 32):
                if state.running:
                    state.message = "OCR is still running"
                    continue

                try:
                    image_path = save_capture(frame, captures_dir)
                except RuntimeError as exc:
                    state.message = str(exc)
                    continue

                outdir = base_outdir / image_path.stem
                job = OcrJob(
                    image_path=image_path,
                    outdir=outdir,
                    device=args.device,
                    output_format=args.format,
                    figure=args.figure,
                    ignore_line_break=args.ignore_line_break,
                    ignore_meta=args.ignore_meta,
                )
                state.message = "Capture saved; OCR queued"
                job_queue.put(job)
    finally:
        job_queue.put(None)
        thread.join()
        capture.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

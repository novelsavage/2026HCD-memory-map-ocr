from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


SUPPORTED_SUFFIXES = {".pdf", ".jpeg", ".jpg", ".png", ".bmp", ".tiff", ".tif"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run YomiToku in CPU lite mode for Japanese document OCR."
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="data/input",
        help="Input image/PDF file or directory. Default: data/input",
    )
    parser.add_argument(
        "-o",
        "--outdir",
        default="outputs/yomitoku",
        help="Output directory. Default: outputs/yomitoku",
    )
    parser.add_argument(
        "-f",
        "--format",
        default="md",
        choices=["md", "json", "csv", "html", "pdf"],
        help="YomiToku output format. Default: md",
    )
    parser.add_argument(
        "--combine",
        action="store_true",
        help="Combine multi-page PDF output into one file.",
    )
    parser.add_argument(
        "--figure",
        action="store_true",
        help="Export detected figures/images.",
    )
    parser.add_argument(
        "--figure-letter",
        action="store_true",
        help="Include text inside detected figures/images.",
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
    parser.add_argument(
        "--reading-order",
        choices=["auto", "top2bottom", "left2right", "right2left"],
        default=None,
        help="Override reading order.",
    )
    parser.add_argument(
        "--no-vis",
        action="store_true",
        help="Do not export visualization images.",
    )
    return parser.parse_args()


def has_supported_input(path: Path) -> bool:
    if path.is_file():
        return path.suffix.lower() in SUPPORTED_SUFFIXES
    if path.is_dir():
        return any(
            child.is_file() and child.suffix.lower() in SUPPORTED_SUFFIXES
            for child in path.rglob("*")
        )
    return False


def main() -> int:
    args = parse_args()

    input_path = Path(args.input)
    outdir = Path(args.outdir)

    if not input_path.exists():
        print(f"Input path does not exist: {input_path}", file=sys.stderr)
        return 2

    if not has_supported_input(input_path):
        suffixes = ", ".join(sorted(SUPPORTED_SUFFIXES))
        print(
            f"No supported input found under {input_path}. Supported: {suffixes}",
            file=sys.stderr,
        )
        return 2

    outdir.mkdir(parents=True, exist_ok=True)

    command = [
        "yomitoku",
        str(input_path),
        "--lite",
        "-d",
        "cpu",
        "-f",
        args.format,
        "-o",
        str(outdir),
    ]

    if not args.no_vis:
        command.append("-v")
    if args.combine:
        command.append("--combine")
    if args.figure:
        command.append("--figure")
    if args.figure_letter:
        command.append("--figure_letter")
    if args.ignore_line_break:
        command.append("--ignore_line_break")
    if args.ignore_meta:
        command.append("--ignore_meta")
    if args.reading_order:
        command.extend(["--reading_order", args.reading_order])

    print("Running:", " ".join(command))
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())

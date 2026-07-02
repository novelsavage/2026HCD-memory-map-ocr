from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


CANVAS_SIZE = 1080
MARGIN = 70
FRAME_INSET = 48

BODY_FONT_MAX = 60
BODY_FONT_MIN = 22
NICKNAME_FONT = 34
GENRE_FONT = 30

BODY_COLOR = (51, 51, 51)
NICKNAME_COLOR = (90, 90, 90)
BG_COLOR = (255, 255, 255)

GENRE_COLORS = {
    "恋愛": (236, 140, 170),
    "友情": (126, 196, 222),
    "学業": (111, 191, 115),
    "部活": (242, 193, 78),
    "行事": (156, 127, 201),
    "その他": (46, 94, 78),
}
DEFAULT_COLOR = (150, 150, 150)

KINSOKU_HEAD = set("、。，．・：；）」』】〕〉》｝］!?！？ー―〜～…ゝゞヽヾ々")
KINSOKU_TAIL = set("（「『【〔〈《｛［")

FONT_SERIF = ""
FONT_SANS = ""
FONT_SANS_BOLD = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate square public memory card PNGs from reviewed WebApp records."
    )
    parser.add_argument(
        "manifest",
        nargs="?",
        type=Path,
        default=Path("outputs/webapp-captures/reitaku-hcd-2026/manifest.json"),
        help="WebApp manifest path.",
    )
    parser.add_argument("--id", dest="ids", action="append", help="Generate only this record id. Can be repeated.")
    parser.add_argument("--force", action="store_true", help="Regenerate even when the PNG already exists.")
    parser.add_argument("--dry-run", action="store_true", help="Print target records without writing PNGs.")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Output directory. Default: <event output>/generated-cards",
    )
    parser.add_argument(
        "--include-non-published",
        action="store_true",
        help="Allow pending/captured records for fixture generation. Production should leave this off.",
    )
    parser.add_argument(
        "--allow-missing-coordinates",
        action="store_true",
        help="Generate cards with 0.000000 coordinates when a record lacks lat/lng.",
    )
    return parser.parse_args()


def configure_fonts() -> None:
    global FONT_SERIF, FONT_SANS, FONT_SANS_BOLD
    FONT_SERIF = find_font(
        "HCD_CARD_FONT_SERIF",
        [
            r"C:\Windows\Fonts\NotoSerifJP-VF.ttf",
            r"C:\Windows\Fonts\BIZ-UDMinchoM.ttc",
            r"C:\Windows\Fonts\yumin.ttf",
            "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
        ],
    )
    FONT_SANS = find_font(
        "HCD_CARD_FONT_SANS",
        [
            r"C:\Windows\Fonts\NotoSansJP-VF.ttf",
            r"C:\Windows\Fonts\BIZ-UDGothicR.ttc",
            r"C:\Windows\Fonts\meiryo.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        ],
    )
    FONT_SANS_BOLD = find_font(
        "HCD_CARD_FONT_SANS_BOLD",
        [
            r"C:\Windows\Fonts\NotoSansJP-VF.ttf",
            r"C:\Windows\Fonts\BIZ-UDGothicB.ttc",
            r"C:\Windows\Fonts\meiryob.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        ],
    )


def find_font(env_name: str, candidates: list[str]) -> str:
    env_value = os.getenv(env_name)
    if env_value and Path(env_value).exists():
        return env_value
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    raise FileNotFoundError(
        f"No Japanese font found for {env_name}. Set {env_name} to a .ttf/.ttc font path."
    )


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_records(base_dir: Path) -> list[dict[str, Any]]:
    return [load_json(path) for path in sorted((base_dir / "records").glob("*.json"))]


def _measure(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    if not text:
        return 0
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def wrap_japanese(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if paragraph == "":
            lines.append("")
            continue
        line = ""
        for ch in paragraph:
            if _measure(draw, line + ch, font) <= max_width or line == "":
                line += ch
            else:
                lines.append(line)
                line = ch
        if line:
            lines.append(line)
    return apply_kinsoku(lines)


def apply_kinsoku(lines: list[str]) -> list[str]:
    changed = True
    guard = 0
    while changed and guard < 50:
        changed = False
        guard += 1
        for index, line in enumerate(lines):
            if index > 0 and line and line[0] in KINSOKU_HEAD:
                lines[index - 1] = lines[index - 1] + line[0]
                lines[index] = line[1:]
                changed = True
            line = lines[index]
            if line and line[-1] in KINSOKU_TAIL and index + 1 < len(lines):
                lines[index + 1] = line[-1] + lines[index + 1]
                lines[index] = line[:-1]
                changed = True
    return lines


def fit_body_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    max_height: int,
    line_spacing: float = 1.5,
) -> tuple[ImageFont.FreeTypeFont, list[str], int, int]:
    for size in range(BODY_FONT_MAX, BODY_FONT_MIN - 1, -2):
        font = ImageFont.truetype(FONT_SERIF, size)
        lines = wrap_japanese(draw, text, font, max_width)
        ascent, descent = font.getmetrics()
        line_height = int((ascent + descent) * line_spacing)
        total_height = line_height * len(lines)
        if total_height <= max_height:
            return font, lines, total_height, line_height

    font = ImageFont.truetype(FONT_SERIF, BODY_FONT_MIN)
    lines = wrap_japanese(draw, text, font, max_width)
    ascent, descent = font.getmetrics()
    line_height = int((ascent + descent) * line_spacing)
    return font, lines, line_height * len(lines), line_height


def mix_color(color: tuple[int, int, int], other: tuple[int, int, int], ratio: float) -> tuple[int, int, int]:
    return tuple(int(c * ratio + o * (1 - ratio)) for c, o in zip(color, other))


def luminance(color: tuple[int, int, int]) -> float:
    r, g, b = color
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255


def readable_text_on(color: tuple[int, int, int]) -> tuple[int, int, int]:
    return (40, 40, 40) if luminance(color) > 0.6 else (255, 255, 255)


def draw_decoration(draw: ImageDraw.ImageDraw, color: tuple[int, int, int]) -> None:
    tint = mix_color(color, (255, 255, 255), 0.10)
    draw.rectangle([MARGIN, MARGIN, CANVAS_SIZE - MARGIN, CANVAS_SIZE - MARGIN], fill=tint)

    fx0 = MARGIN + FRAME_INSET
    fy0 = MARGIN + FRAME_INSET
    fx1 = CANVAS_SIZE - MARGIN - FRAME_INSET
    fy1 = CANVAS_SIZE - MARGIN - FRAME_INSET
    draw.rectangle([fx0, fy0, fx1, fy1], outline=color, width=2)

    acc = 34
    width = 5
    for cx, cy, dx, dy in [
        (fx0, fy0, 1, 1),
        (fx1, fy0, -1, 1),
        (fx0, fy1, 1, -1),
        (fx1, fy1, -1, -1),
    ]:
        draw.line([(cx, cy), (cx + dx * acc, cy)], fill=color, width=width)
        draw.line([(cx, cy), (cx, cy + dy * acc)], fill=color, width=width)

    cx = CANVAS_SIZE // 2
    cy = fy0
    size = 9
    draw.polygon([(cx, cy - size), (cx + size, cy), (cx, cy + size), (cx - size, cy)], fill=color)


def draw_genre_label(draw: ImageDraw.ImageDraw, genre: str, color: tuple[int, int, int]) -> None:
    font = ImageFont.truetype(FONT_SANS_BOLD, GENRE_FONT)
    text = genre
    text_width = _measure(draw, text, font)
    pad_x, pad_y = 24, 12
    text_height = sum(font.getmetrics())

    x1 = CANVAS_SIZE - MARGIN - FRAME_INSET - 10
    y1 = CANVAS_SIZE - MARGIN - FRAME_INSET - 10
    x0 = x1 - (text_width + pad_x * 2)
    y0 = y1 - (text_height + pad_y * 2)

    draw.rounded_rectangle([x0, y0, x1, y1], radius=(y1 - y0) // 2, fill=color)
    draw.text((x0 + pad_x, y0 + pad_y), text, font=font, fill=readable_text_on(color))


def draw_nickname(draw: ImageDraw.ImageDraw, nickname: str, color: tuple[int, int, int]) -> None:
    if not nickname:
        return
    font = ImageFont.truetype(FONT_SANS, NICKNAME_FONT)
    text = f"- {nickname}"
    x0 = MARGIN + FRAME_INSET + 14
    text_height = sum(font.getmetrics())
    y1 = CANVAS_SIZE - MARGIN - FRAME_INSET - 22
    draw.text((x0, y1 - text_height), text, font=font, fill=NICKNAME_COLOR)
    draw.text((x0, y1 - text_height), "-", font=font, fill=color)


def render_card(data: dict[str, Any]) -> Image.Image:
    configure_fonts()
    genre = normalize_genre(str(data.get("genre") or "その他"))
    color = GENRE_COLORS.get(genre, DEFAULT_COLOR)
    memory = str(data.get("memory") or "").strip()
    nickname = str(data.get("nickname") or "").strip()

    if not memory:
        raise ValueError("memory text is required to render a public card")

    img = Image.new("RGB", (CANVAS_SIZE, CANVAS_SIZE), BG_COLOR)
    draw = ImageDraw.Draw(img)

    draw_decoration(draw, color)

    text_left = MARGIN + FRAME_INSET + 60
    text_right = CANVAS_SIZE - MARGIN - FRAME_INSET - 60
    text_top = MARGIN + FRAME_INSET + 70
    text_bottom = CANVAS_SIZE - MARGIN - FRAME_INSET - 90
    area_width = text_right - text_left
    area_height = text_bottom - text_top

    font, lines, total_height, line_height = fit_body_text(draw, memory, area_width, area_height)

    y = text_top + max(0, (area_height - total_height) // 2)
    for line in lines:
        line_width = _measure(draw, line, font)
        x = text_left + (area_width - line_width) // 2
        draw.text((x, y), line, font=font, fill=BODY_COLOR)
        y += line_height

    draw_nickname(draw, nickname, color)
    draw_genre_label(draw, genre, color)
    return img


def normalize_genre(value: str) -> str:
    normalized = value.strip()
    if normalized in {"", "unknown", "未選択", "上記以外", "その他"}:
        return "その他"
    return normalized if normalized in GENRE_COLORS else "その他"


def reviewed_text(record: dict[str, Any]) -> str:
    ocr = record.get("ocr") or {}
    memory = record.get("memory") or {}
    return str(ocr.get("textReviewed") or memory.get("note") or "").strip()


def card_data_from_record(record: dict[str, Any], allow_missing_coordinates: bool = False) -> dict[str, Any]:
    memory = record.get("memory") or {}
    lat, lng = normalized_coordinates(memory, allow_missing_coordinates=allow_missing_coordinates)
    campus = normalize_campus(memory.get("campus"), allow_missing=allow_missing_coordinates)
    return {
        "memory": reviewed_text(record),
        "nickname": str(memory.get("nickname") or "").strip(),
        "era": str(memory.get("era") or "").strip(),
        "genre": normalize_genre(str(memory.get("genre") or "")),
        "latitude": lat,
        "longitude": lng,
        "campus": campus,
        "capturedAt": str((record.get("capture") or {}).get("receivedAt") or ""),
        "id": str(record.get("id") or ""),
    }


def normalize_campus(value: Any, allow_missing: bool = False) -> str:
    campus = str(value or "").strip().lower()
    if campus in {"inside", "outside"}:
        return campus
    if allow_missing:
        return "unknown"
    raise ValueError("campus (inside/outside) judgement is required")


def normalized_coordinates(
    memory: dict[str, Any],
    allow_missing_coordinates: bool = False,
) -> tuple[str, str]:
    raw_lat = str(memory.get("latitude") or "").strip()
    raw_lng = str(memory.get("longitude") or "").strip()
    if not raw_lat or not raw_lng:
        if allow_missing_coordinates:
            return "0.000000", "0.000000"
        raise ValueError("latitude and longitude are required for Unity filename delivery")
    try:
        lat = float(raw_lat)
        lng = float(raw_lng)
    except ValueError as exc:
        raise ValueError(f"invalid latitude/longitude: {raw_lat}, {raw_lng}") from exc
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError(f"latitude/longitude out of range: {raw_lat}, {raw_lng}")
    return f"{lat:.6f}", f"{lng:.6f}"


def build_card_filename(record: dict[str, Any], data: dict[str, Any]) -> str:
    record_id = sanitize_ascii(str(record.get("id") or "unknown"))
    stamp = capture_stamp(record)
    digest = card_content_hash(data)
    lat = sanitize_coordinate(str(data["latitude"]))
    lng = sanitize_coordinate(str(data["longitude"]))
    campus = sanitize_ascii(str(data["campus"]))
    return f"{stamp}_{record_id}_h{digest}_{lat}_{lng}_{campus}.png"


def card_content_hash(data: dict[str, Any]) -> str:
    payload = {
        "memory": str(data.get("memory") or "").strip(),
        "nickname": str(data.get("nickname") or "").strip(),
        "genre": normalize_genre(str(data.get("genre") or "")),
        "latitude": str(data.get("latitude") or "").strip(),
        "longitude": str(data.get("longitude") or "").strip(),
        "campus": str(data.get("campus") or "").strip(),
        "capturedAt": str(data.get("capturedAt") or "").strip(),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def capture_stamp(record: dict[str, Any]) -> str:
    raw = str((record.get("capture") or {}).get("receivedAt") or "")
    if raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
            return dt.strftime("%Y%m%dT%H%M%SZ")
        except ValueError:
            pass
    match = re.search(r"HCD-(\d{8})-(\d{6})", str(record.get("id") or ""))
    if match:
        return f"{match.group(1)}T{match.group(2)}Z"
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def sanitize_ascii(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9.-]+", "-", value).strip("-")
    return cleaned or "none"


def sanitize_coordinate(value: str) -> str:
    cleaned = re.sub(r"[^0-9.+-]+", "", value)
    return cleaned or "0.000000"


def should_generate(record: dict[str, Any], args: argparse.Namespace) -> bool:
    if args.ids and record.get("id") not in set(args.ids):
        return False
    if not args.include_non_published and record.get("status") != "published":
        return False
    if (record.get("review") or {}).get("excludeFromPublish"):
        return False
    return bool(reviewed_text(record))


def generate_card_for_record(
    record: dict[str, Any],
    out_dir: Path,
    force: bool = False,
    allow_missing_coordinates: bool = False,
) -> tuple[Path, Path]:
    data = card_data_from_record(record, allow_missing_coordinates=allow_missing_coordinates)
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = build_card_filename(record, data)
    out_path = out_dir / filename
    data_path = out_dir / f"{out_path.stem}.input.json"
    if force or not out_path.exists():
        render_card(data).save(out_path, "PNG")
        write_json(data_path, data)
    return out_path, data_path


def generate_from_json(json_path: Path, out_dir: Path) -> Path:
    data = load_json(json_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{capture_stamp(data)}_{sanitize_ascii(str(data.get('id') or json_path.stem))}_{sanitize_coordinate(str(data.get('latitude') or '0.000000'))}_{sanitize_coordinate(str(data.get('longitude') or '0.000000'))}.png"
    out_path = out_dir / filename
    render_card(data).save(out_path, "PNG")
    return out_path


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    base_dir = manifest_path.parent
    if not manifest_path.exists():
        print(f"manifest does not exist: {manifest_path}")
        return 2

    out_dir = (args.out_dir or (base_dir / "generated-cards")).resolve()
    records = load_records(base_dir)
    targets = [record for record in records if should_generate(record, args)]

    print(f"target records: {len(targets)}")
    for record in targets:
        print(f"- {record.get('id')} capturedAt={((record.get('capture') or {}).get('receivedAt') or '')}")
    if args.dry_run:
        return 0

    failed = 0
    for record in targets:
        try:
            card_path, data_path = generate_card_for_record(
                record,
                out_dir,
                force=args.force,
                allow_missing_coordinates=args.allow_missing_coordinates,
            )
            print(f"{record.get('id')}: {card_path} ({data_path.name})")
        except Exception as exc:
            failed += 1
            print(f"{record.get('id')}: failed: {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

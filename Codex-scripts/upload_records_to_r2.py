from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
GENERATOR_PATH = SCRIPT_DIR / "generate_memory_card.py"
spec = importlib.util.spec_from_file_location("generate_memory_card", GENERATOR_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load card generator: {GENERATOR_PATH}")
generate_memory_card = importlib.util.module_from_spec(spec)
sys.modules["generate_memory_card"] = generate_memory_card
spec.loader.exec_module(generate_memory_card)

SUPABASE_SYNC_PATH = SCRIPT_DIR / "supabase_sync.py"
supabase_spec = importlib.util.spec_from_file_location("supabase_sync", SUPABASE_SYNC_PATH)
if supabase_spec is None or supabase_spec.loader is None:
    raise RuntimeError(f"Unable to load supabase sync module: {SUPABASE_SYNC_PATH}")
supabase_sync = importlib.util.module_from_spec(supabase_spec)
sys.modules["supabase_sync"] = supabase_sync
supabase_spec.loader.exec_module(supabase_sync)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate reviewed memory-card PNGs and upload only those PNGs to Cloudflare R2."
    )
    parser.add_argument(
        "manifest",
        nargs="?",
        type=Path,
        default=Path("outputs/webapp-captures/reitaku-hcd-2026/manifest.json"),
        help="WebApp manifest path. Default: outputs/webapp-captures/reitaku-hcd-2026/manifest.json",
    )
    parser.add_argument("--id", dest="ids", action="append", help="Upload only this record id. Can be repeated.")
    parser.add_argument("--force", action="store_true", help="Upload even when publish.status is sent.")
    parser.add_argument("--dry-run", action="store_true", help="Write pending plan and skip R2 upload.")
    parser.add_argument("--watch", action="store_true", help="Keep polling records and upload approved cards.")
    parser.add_argument("--interval", type=float, default=1.0, help="Polling interval in seconds for --watch. Default: 1")
    parser.add_argument("--max-loops", type=int, default=0, help="Stop --watch after this many loops. Default: 0 means forever.")
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="In --watch mode, retry records whose publish.status is failed.",
    )
    parser.add_argument(
        "--verify-public",
        action="store_true",
        help="After upload, verify the public card URL with a HEAD request before marking sent.",
    )
    parser.add_argument("--verify-attempts", type=int, default=30, help="Public URL verification attempts. Default: 30")
    parser.add_argument("--verify-delay", type=float, default=2.0, help="Seconds between public URL verification attempts. Default: 2")
    parser.add_argument(
        "--reconcile-public",
        action="store_true",
        help="Check failed records' public card URLs and mark them sent when already reachable.",
    )
    parser.add_argument(
        "--cleanup-duplicates",
        action="store_true",
        help="Migrate sent records to content-hash card keys and delete older duplicate local/R2 cards.",
    )
    parser.add_argument(
        "--keep-old-card-keys",
        action="store_true",
        help="Do not delete old R2 card keys after a successful replacement upload.",
    )
    parser.add_argument("--prefix", default=os.getenv("R2_PREFIX", "events/reitaku-hcd-2026"), help="R2 key prefix.")
    parser.add_argument("--bucket", default=os.getenv("R2_BUCKET", ""), help="R2 bucket. Defaults to R2_BUCKET.")
    parser.add_argument("--public-base-url", default=os.getenv("R2_PUBLIC_BASE_URL", ""), help="Optional public URL root.")
    parser.add_argument("--pending-out", type=Path, default=None, help="Pending upload plan output path.")
    parser.add_argument("--lock-file", type=Path, default=None, help="Worker lock file. Default: <event output>/.r2-worker.lock")
    parser.add_argument("--log-file", type=Path, default=None, help="Append worker logs to this file. Default in --watch: <event output>/r2-worker.log")
    parser.add_argument(
        "--write-plan",
        action="store_true",
        help="Write the pending upload plan JSON. Dry-run defaults to stdout only.",
    )
    parser.add_argument(
        "--uploader",
        choices=["auto", "s3", "wrangler"],
        default=os.getenv("R2_UPLOADER", "auto"),
        help="Upload backend. auto uses S3 credentials when present, otherwise wrangler.",
    )
    parser.add_argument(
        "--cards-dir",
        type=Path,
        default=None,
        help="Generated card directory. Default: <event output>/generated-cards",
    )
    parser.add_argument(
        "--no-supabase",
        action="store_true",
        help="Disable Supabase metadata sync regardless of environment configuration.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_records(base_dir: Path) -> list[dict[str, Any]]:
    return [load_json(path) for path in sorted((base_dir / "records").glob("*.json"))]


def record_path(base_dir: Path, record_id: str) -> Path:
    return base_dir / "records" / f"{record_id}.json"


def rebuild_manifest(base_dir: Path, manifest_path: Path) -> dict[str, Any]:
    records = load_records(base_dir)
    records.sort(key=lambda item: str(item.get("capture", {}).get("receivedAt", "")), reverse=True)
    manifest = {
        "eventId": records[0].get("eventId") if records else "reitaku-hcd-2026",
        "generatedAt": utc_now(),
        "count": len(records),
        "records": records,
    }
    write_json(manifest_path, manifest)
    return manifest


def normalize_prefix(prefix: str) -> str:
    return prefix.strip().strip("/")


def join_key(*parts: str) -> str:
    return "/".join(part.strip("/").replace("\\", "/") for part in parts if part)


def make_public_url(base_url: str, key: str | None) -> str | None:
    if not base_url or not key:
        return None
    return base_url.rstrip("/") + "/" + key.lstrip("/")


def log(args: argparse.Namespace, message: str, *, stream: Any = sys.stdout) -> None:
    print(message, file=stream)
    log_file = getattr(args, "log_file", None)
    if log_file:
        path = Path(log_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8") if not path.exists() else None
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{utc_now()}] {message}\n")


def should_upload(record: dict[str, Any], args: argparse.Namespace, include_failed: bool = True) -> bool:
    if args.ids and record.get("id") not in set(args.ids):
        return False
    if record.get("status") != "published":
        return False
    if (record.get("review") or {}).get("excludeFromPublish"):
        return False
    if not generate_memory_card.reviewed_text(record):
        return False
    publish_status = (record.get("publish") or {}).get("status")
    allowed = {None, "", "not_sent"}
    if include_failed:
        allowed.add("failed")
    return args.force or publish_status in allowed


def build_card_plan(
    base_dir: Path,
    record: dict[str, Any],
    prefix: str,
    cards_dir: Path,
    force: bool,
    allow_missing_coordinates: bool,
) -> dict[str, Any]:
    card_path, input_path = generate_memory_card.generate_card_for_record(
        record,
        cards_dir,
        force=force,
        allow_missing_coordinates=allow_missing_coordinates,
    )
    record_id = str(record["id"])
    key = join_key(prefix, "cards", card_path.name)
    data = generate_memory_card.card_data_from_record(
        record,
        allow_missing_coordinates=allow_missing_coordinates,
    )
    return {
        "id": record_id,
        "sourceVersion": record.get("version"),
        "card": {
            "path": str(card_path),
            "inputPath": str(input_path),
            "key": key,
            "contentType": "image/png",
            "filename": card_path.name,
        },
        "unityFilenameFields": {
            "capturedAt": generate_memory_card.capture_stamp(record),
            "latitude": data["latitude"],
            "longitude": data["longitude"],
        },
    }


def set_publish_state(
    base_dir: Path,
    manifest_path: Path,
    record: dict[str, Any],
    status: str,
    **updates: Any,
) -> dict[str, Any]:
    next_record = dict(record)
    next_record["version"] = int(next_record.get("version") or 1) + 1
    next_record["updatedAt"] = utc_now()
    publish = {
        "status": "not_sent",
        "sentAt": None,
        "bucket": "",
        "prefix": "",
        "originalKey": None,
        "cropKey": None,
        "recordKey": None,
        "manifestKey": None,
        "publicImageUrl": None,
        "cardKey": None,
        "cardFileName": None,
        "generatedCardPath": None,
        "cardGeneratedAt": None,
        "cardSourceVersion": None,
        "lastError": None,
        "supabaseSynced": False,
        "supabaseSyncedAt": None,
        "supabaseError": None,
    }
    publish.update(record.get("publish") or {})
    publish.update(updates)
    publish["status"] = status
    if status in {"not_sent", "failed"}:
        publish["sentAt"] = None
    next_record["publish"] = publish
    sync = {"labPcSent": False, "cloudUploaded": False, "lastError": None}
    sync.update(record.get("sync") or {})
    sync["cloudUploaded"] = status == "sent"
    sync["lastError"] = publish.get("lastError")
    next_record["sync"] = sync
    write_json(record_path(base_dir, str(record["id"])), next_record)
    rebuild_manifest(base_dir, manifest_path)
    return next_record


def create_s3_client():
    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError("boto3 is not installed. Run `uv add boto3`.") from exc

    account_id = os.getenv("R2_ACCOUNT_ID", "")
    access_key = os.getenv("R2_ACCESS_KEY_ID", "")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY", "")
    if not account_id or not access_key or not secret_key:
        raise RuntimeError("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required.")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


def has_s3_credentials() -> bool:
    return all(
        os.getenv(name)
        for name in ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
    )


def resolve_uploader(name: str) -> str:
    if name == "auto":
        return "s3" if has_s3_credentials() else "wrangler"
    return name


def upload_file(client: Any, bucket: str, path: Path, key: str, content_type: str) -> None:
    client.upload_file(
        str(path),
        bucket,
        key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"},
    )


def upload_file_with_wrangler(bucket: str, path: Path, key: str, content_type: str) -> None:
    wrangler = find_wrangler()
    command = [
        wrangler,
        "r2",
        "object",
        "put",
        f"{bucket}/{key}",
        "--file",
        str(path),
        "--content-type",
        content_type,
        "--cache-control",
        "public, max-age=31536000, immutable",
        "--remote",
        "--force",
    ]
    result = subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
        cwd=Path.cwd(),
    )
    if result.returncode != 0:
        detail = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
        raise RuntimeError(f"wrangler upload failed: {detail[-2000:]}")


def delete_remote_object(
    args: argparse.Namespace,
    client: Any,
    bucket: str,
    key: str,
    uploader: str,
) -> bool:
    if not bucket or not key:
        return False
    try:
        if uploader == "s3":
            client.delete_object(Bucket=bucket, Key=key)
        else:
            delete_remote_object_with_wrangler(bucket, key)
        log(args, f"deleted old R2 card {key}")
        return True
    except Exception as exc:
        log(args, f"warning: failed to delete old R2 card {key}: {exc}", stream=sys.stderr)
        return False


def delete_remote_object_with_wrangler(bucket: str, key: str) -> None:
    wrangler = find_wrangler()
    command = [
        wrangler,
        "r2",
        "object",
        "delete",
        f"{bucket}/{key}",
        "--remote",
    ]
    result = subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
        cwd=Path.cwd(),
    )
    if result.returncode != 0:
        detail = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
        raise RuntimeError(f"wrangler delete failed: {detail[-2000:]}")


def find_wrangler() -> str:
    repo_root = SCRIPT_DIR.parent
    candidates = [
        repo_root / "WebApp" / "node_modules" / ".bin" / "wrangler.cmd",
        repo_root / "WebApp" / "node_modules" / ".bin" / "wrangler",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate.resolve())
    global_path = shutil.which("wrangler")
    if global_path:
        return global_path
    npx = shutil.which("npx.cmd") or shutil.which("npx")
    if npx:
        # npx is not usable as a direct executable with the fixed argument layout above.
        # Keep the error actionable instead of silently changing invocation semantics.
        raise RuntimeError("wrangler binary was not found. Run from repo with WebApp/node_modules installed.")
    raise RuntimeError("wrangler command was not found. Run `npm install` under WebApp or use --uploader s3.")


def verify_public_url(url: str, attempts: int, delay: float) -> None:
    request = urllib.request.Request(
        url,
        method="HEAD",
        headers={
            "User-Agent": "hcd-memory-map-r2-worker/1.0",
            "Accept": "image/png,*/*;q=0.8",
        },
    )
    last_error = ""
    for attempt in range(1, max(1, attempts) + 1):
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                status = int(response.status)
                content_type = response.headers.get("Content-Type", "")
            if status < 200 or status >= 400:
                raise RuntimeError(f"public URL returned HTTP {status}: {url}")
            if "image/png" not in content_type.lower():
                raise RuntimeError(f"public URL content type is not image/png: {content_type}")
            return
        except urllib.error.HTTPError as exc:
            last_error = f"public URL returned HTTP {exc.code}: {url}"
        except urllib.error.URLError as exc:
            last_error = f"public URL verification failed: {exc.reason}"
        except RuntimeError as exc:
            last_error = str(exc)
        if attempt < max(1, attempts):
            time.sleep(max(0.1, delay))
    raise RuntimeError(last_error or f"public URL verification failed: {url}")


def acquire_lock(path: Path) -> None:
    payload = {
        "pid": os.getpid(),
        "startedAt": utc_now(),
        "command": " ".join(sys.argv),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
    except FileExistsError as exc:
        detail = ""
        try:
            detail = path.read_text(encoding="utf-8")
        except OSError:
            pass
        raise RuntimeError(f"R2 worker lock already exists: {path}\n{detail}") from exc


def release_lock(path: Path) -> None:
    try:
        payload = load_json(path)
        if payload.get("pid") == os.getpid():
            path.unlink()
    except FileNotFoundError:
        return
    except Exception:
        return


def build_pending_plan(
    base_dir: Path,
    args: argparse.Namespace,
    prefix: str,
    cards_dir: Path,
    include_failed: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]:
    records = load_records(base_dir)
    targets = [record for record in records if should_upload(record, args, include_failed=include_failed)]
    plans: list[dict[str, Any]] = []
    blocked: list[dict[str, str]] = []
    for record in targets:
        try:
            plans.append(
                build_card_plan(
                    base_dir,
                    record,
                    prefix,
                    cards_dir,
                    force=args.force,
                    allow_missing_coordinates=False,
                )
            )
        except Exception as exc:
            reason = str(exc)
            blocked.append({"id": str(record.get("id")), "reason": reason[-500:]})

    plan_payload = {
        "generatedAt": utc_now(),
        "bucket": args.bucket,
        "prefix": prefix,
        "note": "Only regenerated public card PNGs are uploaded. Original/crop/OCR/record JSON are local-only.",
        "count": len(plans),
        "blockedCount": len(blocked),
        "blocked": blocked,
        "records": plans,
    }
    return plans, blocked, plan_payload


def print_plan_summary(
    args: argparse.Namespace,
    plans: list[dict[str, Any]],
    blocked: list[dict[str, str]],
    pending_out: Path,
    *,
    quiet_when_empty: bool = False,
) -> None:
    if quiet_when_empty and not plans and not blocked:
        return
    log(args, f"pending card uploads: {len(plans)}")
    if args.write_plan or not args.dry_run:
        log(args, f"pending plan: {pending_out}")
    else:
        log(args, "pending plan: not written; pass --write-plan to write r2-pending-cards.json")
    for plan in plans:
        log(args, f"- {plan['id']} -> {plan['card']['key']}")
    if blocked:
        log(args, f"blocked records: {len(blocked)}")
        for item in blocked:
            log(args, f"- {item['id']}: {item['reason']}")


def build_supabase_payload(
    record: dict[str, Any],
    plan: dict[str, Any],
    public_url: str | None,
) -> dict[str, Any]:
    card_data = generate_memory_card.card_data_from_record(record, allow_missing_coordinates=False)
    publish = record.get("publish") or {}
    capture = record.get("capture") or {}
    campus = card_data["campus"]
    return {
        "id": str(record.get("id") or ""),
        "event_id": record.get("eventId"),
        "status": "published",
        "nickname": card_data["nickname"],
        "memory_text": generate_memory_card.reviewed_text(record),
        "genre": card_data["genre"],
        "era": card_data["era"],
        "latitude": float(card_data["latitude"]),
        "longitude": float(card_data["longitude"]),
        "captured_at": capture.get("receivedAt"),
        "card_url": public_url,
        "card_key": plan["card"]["key"],
        "content_hash": generate_memory_card.card_content_hash(card_data),
        "card_generated_at": publish.get("cardGeneratedAt"),
        "reitaku_dummy": campus == "inside",
        # created_at は送らない（DBのdefault now()でINSERT時のみ設定し、再upsertで上書きしない）。
        # updated_at はPostgRESTのUPDATEでdefaultが再発火しないため、トリガー非依存で明示送信する。
        "updated_at": utc_now(),
    }


def sync_supabase(
    base_dir: Path,
    manifest_path: Path,
    args: argparse.Namespace,
    record: dict[str, Any],
    plan: dict[str, Any],
    public_url: str | None,
) -> None:
    record_id = str(record.get("id") or "")
    try:
        payload = build_supabase_payload(record, plan, public_url)
        supabase_sync.upsert_memory(payload)
    except Exception as exc:
        log(args, f"{record_id}: supabase sync failed: {exc}", stream=sys.stderr)
        set_publish_state(
            base_dir,
            manifest_path,
            record,
            "sent",
            supabaseSynced=False,
            supabaseError=str(exc)[-2000:],
        )
        return
    set_publish_state(
        base_dir,
        manifest_path,
        record,
        "sent",
        supabaseSynced=True,
        supabaseSyncedAt=utc_now(),
        supabaseError=None,
    )
    log(args, f"{record_id}: supabase synced")


def run_once(
    base_dir: Path,
    manifest_path: Path,
    args: argparse.Namespace,
    *,
    include_failed: bool,
    quiet_when_empty: bool = False,
    suppress_plan_summary: bool = False,
) -> dict[str, Any]:
    prefix = normalize_prefix(args.prefix)
    cards_dir = (args.cards_dir or (base_dir / "generated-cards")).resolve()
    plans, blocked, plan_payload = build_pending_plan(
        base_dir,
        args,
        prefix,
        cards_dir,
        include_failed=include_failed,
    )
    pending_out = args.pending_out or (base_dir / "r2-pending-cards.json")
    if args.write_plan or not args.dry_run:
        write_json(pending_out, plan_payload)

    if not suppress_plan_summary:
        print_plan_summary(args, plans, blocked, pending_out, quiet_when_empty=quiet_when_empty)

    if args.dry_run:
        return {"planned": len(plans), "sent": 0, "failed": 0, "blocked": len(blocked), "blockedItems": blocked}
    if not args.bucket:
        raise RuntimeError("R2_BUCKET or --bucket is required.")

    uploader = resolve_uploader(args.uploader)
    if plans:
        log(args, f"uploader: {uploader}")
    client = create_s3_client() if uploader == "s3" else None
    sent = 0
    failed = 0
    for plan in plans:
        record_id = str(plan["id"])
        record: dict[str, Any] | None = None
        try:
            record = load_json(record_path(base_dir, record_id))
            if record.get("version") != plan.get("sourceVersion"):
                raise RuntimeError(
                    f"record version changed during upload planning: planned={plan.get('sourceVersion')} current={record.get('version')}"
                )
            if not should_upload(record, args, include_failed=include_failed):
                raise RuntimeError("record is no longer uploadable")
            previous_card_key = str((record.get("publish") or {}).get("cardKey") or "")
            current = set_publish_state(
                base_dir,
                manifest_path,
                record,
                "sending",
                bucket=args.bucket,
                prefix=prefix,
                generatedCardPath=relative_to_base(base_dir, Path(plan["card"]["path"])),
                cardFileName=plan["card"]["filename"],
                cardKey=plan["card"]["key"],
                cardGeneratedAt=utc_now(),
                cardSourceVersion=record.get("version"),
                originalKey=None,
                cropKey=None,
                recordKey=None,
                manifestKey=None,
                publicImageUrl=None,
                lastError=None,
            )
            if uploader == "s3":
                upload_file(
                    client,
                    args.bucket,
                    Path(plan["card"]["path"]),
                    plan["card"]["key"],
                    "image/png",
                )
            else:
                upload_file_with_wrangler(
                    args.bucket,
                    Path(plan["card"]["path"]),
                    plan["card"]["key"],
                    "image/png",
                )
            public_url = make_public_url(args.public_base_url, plan["card"]["key"])
            if args.verify_public:
                if not public_url:
                    raise RuntimeError("--verify-public requires --public-base-url or R2_PUBLIC_BASE_URL")
                verify_public_url(public_url, attempts=args.verify_attempts, delay=args.verify_delay)
            current = set_publish_state(
                base_dir,
                manifest_path,
                current,
                "sent",
                sentAt=utc_now(),
                bucket=args.bucket,
                prefix=prefix,
                generatedCardPath=relative_to_base(base_dir, Path(plan["card"]["path"])),
                cardFileName=plan["card"]["filename"],
                cardKey=plan["card"]["key"],
                publicImageUrl=public_url,
                lastError=None,
            )
            sent += 1
            log(args, f"{record_id}: sent card {public_url or plan['card']['key']}")
            if previous_card_key and previous_card_key != plan["card"]["key"] and not args.keep_old_card_keys:
                delete_remote_object(args, client, args.bucket, previous_card_key, uploader)
            if supabase_sync.supabase_enabled() and not args.no_supabase:
                sync_supabase(base_dir, manifest_path, args, current, plan, public_url)
        except Exception as exc:
            failed += 1
            log(args, f"{record_id}: failed: {exc}", stream=sys.stderr)
            if record is not None:
                set_publish_state(
                    base_dir,
                    manifest_path,
                    record,
                    "failed",
                    bucket=args.bucket,
                    prefix=prefix,
                    cardKey=plan["card"]["key"],
                    generatedCardPath=relative_to_base(base_dir, Path(plan["card"]["path"])),
                    lastError=str(exc)[-2000:],
                )

    return {"planned": len(plans), "sent": sent, "failed": failed, "blocked": len(blocked), "blockedItems": blocked}


def run_watch(base_dir: Path, manifest_path: Path, args: argparse.Namespace) -> int:
    lock_file = (args.lock_file or (base_dir / ".r2-worker.lock")).resolve()
    acquire_lock(lock_file)
    log(args, f"watching: {base_dir / 'records'}")
    log(args, f"interval: {args.interval:g}s retry_failed={args.retry_failed} dry_run={args.dry_run}")
    log(args, f"lock: {lock_file}")
    log(args, "Press Ctrl+C to stop.")
    last_summary = ""
    last_summary_at = 0.0
    loops = 0
    try:
        while True:
            loops += 1
            result = run_once(
                base_dir,
                manifest_path,
                args,
                include_failed=args.retry_failed,
                quiet_when_empty=True,
                suppress_plan_summary=True,
            )
            summary = (
                f"planned={result['planned']} sent={result['sent']} "
                f"failed={result['failed']} blocked={result['blocked']}"
            )
            now = time.monotonic()
            if result["planned"] or result["sent"] or result["failed"] or summary != last_summary or now - last_summary_at >= 60:
                log(args, f"worker pass: {summary}")
                if summary != last_summary and result.get("blockedItems"):
                    for item in result["blockedItems"]:
                        log(args, f"- blocked {item['id']}: {item['reason']}")
                last_summary = summary
                last_summary_at = now
            if args.max_loops and loops >= args.max_loops:
                log(args, f"stopped after max loops: {args.max_loops}")
                return 0
            time.sleep(max(0.1, args.interval))
    except KeyboardInterrupt:
        log(args, "stopped")
        return 0
    finally:
        release_lock(lock_file)


def run_reconcile_public(base_dir: Path, manifest_path: Path, args: argparse.Namespace) -> int:
    records = load_records(base_dir)
    candidates = []
    for record in records:
        if args.ids and record.get("id") not in set(args.ids):
            continue
        publish = record.get("publish") or {}
        if publish.get("status") != "failed":
            continue
        card_key = publish.get("cardKey")
        public_url = publish.get("publicImageUrl") or make_public_url(args.public_base_url, card_key)
        if card_key and public_url:
            candidates.append((record, public_url))

    log(args, f"reconcile candidates: {len(candidates)}")
    failed = 0
    reconciled = 0
    prefix = normalize_prefix(args.prefix)
    for record, public_url in candidates:
        record_id = str(record.get("id"))
        try:
            verify_public_url(public_url, attempts=args.verify_attempts, delay=args.verify_delay)
            publish = record.get("publish") or {}
            set_publish_state(
                base_dir,
                manifest_path,
                record,
                "sent",
                sentAt=utc_now(),
                bucket=publish.get("bucket") or args.bucket,
                prefix=publish.get("prefix") or prefix,
                publicImageUrl=public_url,
                lastError=None,
            )
            reconciled += 1
            log(args, f"{record_id}: reconciled sent {public_url}")
        except Exception as exc:
            failed += 1
            log(args, f"{record_id}: reconcile failed: {exc}", stream=sys.stderr)
    return 1 if failed else 0


def run_cleanup_duplicates(base_dir: Path, manifest_path: Path, args: argparse.Namespace) -> int:
    prefix = normalize_prefix(args.prefix)
    cards_dir = (args.cards_dir or (base_dir / "generated-cards")).resolve()
    records = load_records(base_dir)
    uploader = resolve_uploader(args.uploader)
    client = create_s3_client() if uploader == "s3" and not args.dry_run else None
    if not args.bucket and not args.dry_run:
        raise RuntimeError("R2_BUCKET or --bucket is required for --cleanup-duplicates.")

    candidates = []
    for record in records:
        if args.ids and record.get("id") not in set(args.ids):
            continue
        if record.get("status") != "published":
            continue
        if (record.get("review") or {}).get("excludeFromPublish"):
            continue
        if not generate_memory_card.reviewed_text(record):
            continue
        try:
            plan = build_card_plan(
                base_dir,
                record,
                prefix,
                cards_dir,
                force=args.force,
                allow_missing_coordinates=False,
            )
            candidates.append((record, plan))
        except Exception as exc:
            log(args, f"{record.get('id')}: cleanup skipped: {exc}", stream=sys.stderr)

    log(args, f"cleanup candidates: {len(candidates)}")
    failed = 0
    cleaned = 0
    for record, plan in candidates:
        record_id = str(record["id"])
        canonical_key = str(plan["card"]["key"])
        publish = record.get("publish") or {}
        current_key = str(publish.get("cardKey") or "")
        duplicate_keys = gather_duplicate_card_keys(base_dir, cards_dir, prefix, record_id)
        if current_key:
            duplicate_keys.add(current_key)
        duplicate_keys.discard(canonical_key)

        try:
            if current_key != canonical_key:
                public_url = make_public_url(args.public_base_url, canonical_key)
                log(args, f"{record_id}: migrate card key -> {canonical_key}")
                if not args.dry_run:
                    if uploader == "s3":
                        upload_file(client, args.bucket, Path(plan["card"]["path"]), canonical_key, "image/png")
                    else:
                        upload_file_with_wrangler(args.bucket, Path(plan["card"]["path"]), canonical_key, "image/png")
                    if args.verify_public:
                        if not public_url:
                            raise RuntimeError("--verify-public requires --public-base-url or R2_PUBLIC_BASE_URL")
                        verify_public_url(public_url, attempts=args.verify_attempts, delay=args.verify_delay)
                    set_publish_state(
                        base_dir,
                        manifest_path,
                        record,
                        "sent",
                        sentAt=utc_now(),
                        bucket=publish.get("bucket") or args.bucket,
                        prefix=publish.get("prefix") or prefix,
                        generatedCardPath=relative_to_base(base_dir, Path(plan["card"]["path"])),
                        cardFileName=plan["card"]["filename"],
                        cardKey=canonical_key,
                        cardGeneratedAt=utc_now(),
                        cardSourceVersion=record.get("version"),
                        publicImageUrl=public_url,
                        lastError=None,
                    )
                if current_key:
                    duplicate_keys.add(current_key)

            if duplicate_keys:
                log(args, f"{record_id}: duplicate R2 keys={len(duplicate_keys)}")
            for key in sorted(duplicate_keys):
                if args.dry_run or args.keep_old_card_keys:
                    log(args, f"{record_id}: would delete old R2 card {key}")
                else:
                    delete_remote_object(args, client, args.bucket, key, uploader)

            if args.dry_run:
                removable_local = find_local_duplicate_cards(cards_dir, record_id, Path(plan["card"]["path"]))
                if removable_local:
                    log(args, f"{record_id}: would delete local duplicate files={len(removable_local)}")
            else:
                removed_local = cleanup_local_duplicate_cards(cards_dir, record_id, Path(plan["card"]["path"]))
                if removed_local:
                    log(args, f"{record_id}: deleted local duplicate files={removed_local}")
            cleaned += 1
        except Exception as exc:
            failed += 1
            log(args, f"{record_id}: cleanup failed: {exc}", stream=sys.stderr)

    log(args, f"cleanup done: cleaned={cleaned} failed={failed}")
    return 1 if failed else 0


def gather_duplicate_card_keys(base_dir: Path, cards_dir: Path, prefix: str, record_id: str) -> set[str]:
    keys: set[str] = set()
    marker = f"_{record_id}_"
    for path in cards_dir.glob("*.png"):
        if marker in path.name:
            keys.add(join_key(prefix, "cards", path.name))

    log_path = base_dir / "r2-worker.log"
    if log_path.exists():
        text = log_path.read_text(encoding="utf-8", errors="replace")
        key_pattern = re.compile(rf"({re.escape(prefix)}/cards/[^\s]+?{re.escape(record_id)}[^\s]+?\.png)")
        for match in key_pattern.finditer(text):
            keys.add(match.group(1).rstrip(".,;"))
    return keys


def cleanup_local_duplicate_cards(cards_dir: Path, record_id: str, canonical_path: Path) -> int:
    paths = find_local_duplicate_cards(cards_dir, record_id, canonical_path)
    removed = 0
    for path in paths:
        try:
            path.unlink()
            removed += 1
        except FileNotFoundError:
            pass
    return removed


def find_local_duplicate_cards(cards_dir: Path, record_id: str, canonical_path: Path) -> list[Path]:
    marker = f"_{record_id}_"
    canonical_stem = canonical_path.stem
    keep_names = {canonical_path.name, f"{canonical_stem}.input.json"}
    paths: list[Path] = []
    for path in cards_dir.glob("*"):
        if marker not in path.name:
            continue
        if path.name in keep_names:
            continue
        if path.suffix.lower() not in {".png", ".json"}:
            continue
        paths.append(path)
    return paths


def main() -> int:
    args = parse_args()
    supabase_sync.load_env_file(SCRIPT_DIR.parent / ".env.local")
    if args.watch and args.force:
        print("--force cannot be used with --watch because it would re-upload sent records every loop.", file=sys.stderr)
        return 2
    if args.interval <= 0:
        print("--interval must be greater than 0.", file=sys.stderr)
        return 2
    if args.max_loops < 0:
        print("--max-loops must be zero or greater.", file=sys.stderr)
        return 2

    manifest_path = args.manifest.resolve()
    base_dir = manifest_path.parent
    if not manifest_path.exists():
        print(f"manifest does not exist: {manifest_path}", file=sys.stderr)
        return 2
    if args.watch and args.log_file is None:
        args.log_file = base_dir / "r2-worker.log"

    try:
        if args.cleanup_duplicates:
            return run_cleanup_duplicates(base_dir, manifest_path, args)
        if args.reconcile_public:
            return run_reconcile_public(base_dir, manifest_path, args)
        if args.watch:
            return run_watch(base_dir, manifest_path, args)
        result = run_once(base_dir, manifest_path, args, include_failed=True)
        return 1 if result["failed"] else 0
    except Exception as exc:
        log(args, f"fatal: {exc}", stream=sys.stderr)
        return 2


def relative_to_base(base_dir: Path, path: Path) -> str:
    try:
        return str(path.resolve().relative_to(base_dir.resolve()))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())

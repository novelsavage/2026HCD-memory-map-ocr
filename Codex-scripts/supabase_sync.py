from __future__ import annotations

import os
from pathlib import Path

import httpx


REQUEST_TIMEOUT = 30.0


def load_env_file(path: Path) -> None:
    path = Path(path)
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        if not key:
            continue
        if key in os.environ:
            continue
        os.environ[key] = value


def supabase_enabled() -> bool:
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SECRET_KEY"):
        return False
    return os.getenv("HCD_SUPABASE_SYNC", "1") not in {"0", "false", "False", ""}


def table_name() -> str:
    return os.getenv("SUPABASE_TABLE", "memories")


def _auth_headers() -> dict[str, str]:
    secret = os.getenv("SUPABASE_SECRET_KEY", "")
    return {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
    }


def upsert_memory(payload: dict) -> None:
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    table = table_name()
    url = f"{base_url}/rest/v1/{table}?on_conflict=id"
    headers = _auth_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    response = httpx.post(url, json=[payload], headers=headers, timeout=REQUEST_TIMEOUT)
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(
            f"Supabase upsert failed: HTTP {response.status_code}: {response.text}"
        )


def delete_memory(record_id: str) -> None:
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    table = table_name()
    url = f"{base_url}/rest/v1/{table}?id=eq.{record_id}"
    headers = _auth_headers()
    response = httpx.delete(url, headers=headers, timeout=REQUEST_TIMEOUT)
    if response.status_code == 404:
        return
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(
            f"Supabase delete failed: HTTP {response.status_code}: {response.text}"
        )

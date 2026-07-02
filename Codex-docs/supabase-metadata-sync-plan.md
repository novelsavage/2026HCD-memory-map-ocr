# Supabaseメタデータ同期設計

作成日: 2026-06-16

## 目的

レビュー済みrecordのメタデータを、R2公開カードPNGと整合した形でSupabase（`public.memories`）へ同期する。Unityはファイル名から読むが、検索・集計・将来のWebビューのためにメタデータをSupabaseにも持たせる。

## アーキテクチャ

同期はR2 worker（`Codex-scripts/upload_records_to_r2.py`）が担当する。

```text
record (published / publish.not_sent)
  -> カードPNGをR2へアップロード
  -> 公開URLを HEAD 検証（200 / image/png）
  -> publish.status = sent
  -> SupabaseへPostgREST RESTでupsert
```

ポイント:

- SupabaseへのupsertはR2公開URLの `HEAD` 検証が成功し、`publish.status = sent` になった**後だけ**実行する。
- これにより「行は見えるが画像がまだ公開されていない」というrealtimeの競合（行が画像より先に出る状態）を防ぐ。
- upsertはPostgREST REST（`POST /rest/v1/memories?on_conflict=id`、`Prefer: resolution=merge-duplicates`）で行う。`id` をconflict keyにして冪等にする。

## record側の同期ステート

upsert結果を `record.publish` に残す。

- `publish.supabaseSynced`: boolean
- `publish.supabaseSyncedAt`: string | null（同期成功時刻 UTC）
- `publish.supabaseError`: string | null（失敗時のメッセージ、成功時は `null`）

## テーブル: public.memories

既存カラム:

```text
id
event_id
status
nickname
memory_text
genre
era
latitude
longitude
captured_at
card_url
card_key
content_hash
card_generated_at
updated_at
```

加えて、チームメンバーが既存 `public.memories` テーブルの**末尾に追加した**boolean列:

```text
reitaku_dummy   BOOLEAN
```

### ワーカーが送るpayloadと `created_at` / `updated_at`

ワーカー(`build_supabase_payload`)が送るキーは上記列のうち以下:

```text
id, event_id, status, nickname, memory_text, genre, era,
latitude, longitude, captured_at, card_url, card_key,
content_hash, card_generated_at, reitaku_dummy, updated_at
```

- `created_at` 列は廃止済み（テーブルから削除）。ワーカーは元々送っていないため影響なし。
- `updated_at` は**毎回ワーカーが明示送信する**（`utc_now()`）。PostgRESTのupsert更新では列defaultが再発火しないので、`updated_at` 自動更新トリガーの有無に依存しないようにするため。

## campusモデル

`record.memory.campus` を単一の真実とする。

- `"inside"` = 大学内
- `"outside"` = 大学外
- `"unknown"` = 未判定（既定値）

判定はWebAppのレビュー担当者が行い、record JSON -> R2カードファイル名 -> Supabaseの順に流れる。

### 公開ゲート

- `campus = "unknown"` は公開/アップロードしない。座標欠落と同じ扱いでブロックする。
- したがって `"unknown"` はR2にもSupabaseにも到達しない。

## マッピング

```text
reitaku_dummy = (campus === "inside")
```

- `inside`（大学内） -> `reitaku_dummy = true`
- `outside`（大学外） -> `reitaku_dummy = false`
- `unknown` は公開ゲートでブロックされるためSupabaseに届かない

> 要確認: `reitaku_dummy = true ⇔ inside`（大学内=true / 大学外=false）の向きが、列を追加したチームメンバーの意図と一致しているかを確認する。`reitaku_dummy` という列名はダミー/暫定の可能性があり、本番列名と真偽の向きの両方を要確認とする。

## 環境変数

R2 workerはプロジェクトルートの `.env.local` から読む。Next.jsはこのファイルを読まず、WebAppはこのシークレットを使わない（公開アプリにシークレットを出さない）。

```text
SUPABASE_URL=
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_TABLE=memories
HCD_SUPABASE_SYNC=1
```

- `SUPABASE_SECRET_KEY` は `sb_secret_...` 形式のサーバー/ローカル専用シークレット。Gitにも公開アプリにも絶対に入れない。
- `HCD_SUPABASE_SYNC=1` のときだけ同期を有効化する。未設定/`0` のときはR2送信のみ行い、Supabase同期はスキップする。
- workerは `.env.local` 用のローダーで上記を読み込む（Next.jsの仕組みには依存しない）。

## 失敗時の扱い

- Supabase upsertが失敗しても、R2公開（`publish.status = sent`）はすでに成立しているため取り消さない。
- 失敗は `publish.supabaseError` に残し、`publish.supabaseSynced = false` のままにする。
- 次回のworkerループ、または再同期コマンドで `supabaseSynced = false` のsent recordを再upsertできる設計にする（冪等upsertのため安全）。

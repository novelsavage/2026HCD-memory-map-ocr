# OCRパイプライン運用メモ

作成日: 2026-06-15

## 目的

WebAppが保存した撮影データを、次の状態まで進める。

```text
captured
  -> YomiToku OCR
  -> pending_review
  -> 管理画面で承認
  -> published / publish.status = not_sent
  -> R2送信
  -> publish.status = sent
```

OCRはWebAppのリクエスト中には実行しない。`outputs/webapp-captures/<eventId>/records/*.json` をCLIで後処理する。

## OCR実行

常駐workerとして起動する。本番はこの形を推奨する。

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json --watch --interval 1
```

このworkerは1秒ごとに `records/*.json` を読み、`status = captured` かつ `ocr.status = not_run` のrecordを見つけたら、crop画像優先でYomiToku GPU OCRを実行する。

失敗済みrecordもworkerで再試行したい場合:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json --watch --interval 1 --retry-failed
```

1回だけ処理する場合:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

確認だけ:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json --dry-run
```

特定IDだけ再実行:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json --id HCD-20260612-121502-CFEX --force
```

処理内容:

- `capture.crop.localImagePath` があればcropを優先してOCRする
- なければ `capture.localImagePath` をOCRする
- YomiTokuは `--lite -d cuda -f json -v` で実行する
- GPUが使えないPCで緊急退避する場合だけ `--device cpu` を指定する
- OCR成果物は `outputs/webapp-captures/<eventId>/ocr/<recordId>/` に保存する
- 成功時は `ocr.status = succeeded`、`status = pending_review` にする
- 既に `published` のrecordを `--force` OCRしても `published` は維持する
- 失敗時は `ocr.status = failed` と `ocr.lastError` に残す
- watch中は標準では失敗済みrecordを再試行しない。再試行する場合は `--retry-failed` を使う

## R2送信待ち確認

```powershell
uv run python Codex-scripts/upload_records_to_r2.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json --dry-run
```

`published` かつ `publish.status = not_sent | failed` のrecordのうち、R2公開可能なものだけを `r2-pending-cards.json` にまとめる。

新方針ではR2に送るのはレビュー済み本文から再生成したカードPNGだけ。元画像、crop画像、OCR overlay、record JSON、公開manifest JSONは送らない。

## R2送信

必要な環境変数:

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hcd-memory-map
R2_PREFIX=events/reitaku-hcd-2026
R2_PUBLIC_BASE_URL=
```

wranglerログイン済みの場合はS3互換キーなしでも送信できる。`R2_UPLOADER=auto` の既定では、S3キーがあればboto3、なければwranglerを使う。

実行:

```powershell
uv run python Codex-scripts/upload_records_to_r2.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

送信対象:

- `events/reitaku-hcd-2026/cards/<capturedAt>_<recordId>_<latitude>_<longitude>.png`

成功時は `publish.status = sent`、`publish.cardKey`、`publish.publicImageUrl`、`publish.generatedCardPath` が更新される。旧成果物用の `originalKey`、`cropKey`、`recordKey`、`manifestKey` は `null` のままにする。R2認証情報はGitに入れない。

詳細は `Codex-docs/public-card-r2-pipeline.md` を正とする。

## Supabaseメタデータ同期

R2 worker（`upload_records_to_r2.py`）は、カードPNGをR2へ送って公開URLを `HEAD` 検証し `publish.status = sent` にした**後**、`public.memories` へメタデータをPostgREST RESTでupsertする。行が画像より先に見える競合を避けるため、必ずR2公開確認の後に同期する。

環境変数はプロジェクトルートの `.env.local` から読む（Next.jsは読まない / WebAppはシークレットを使わない）。

```text
SUPABASE_URL=
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_TABLE=memories
HCD_SUPABASE_SYNC=1
```

`HCD_SUPABASE_SYNC=1` のときだけ同期する。`SUPABASE_SECRET_KEY` はサーバー/ローカル専用でGitに入れない。

キャンパス内外（`record.memory.campus` = `inside` / `outside` / `unknown`）は公開前に必ず判定する。`unknown` は座標欠落と同様に公開ブロックで、R2にもSupabaseにも届かない。Supabaseの `reitaku_dummy` は `campus === "inside"`（大学内=true / 大学外=false）でマッピングする（要確認）。

詳細は `Codex-docs/supabase-metadata-sync-plan.md` を正とする。

## OCR精度評価

既存のYomiToku JSONを集計する:

```powershell
uv run python Codex-scripts/evaluate_yomitoku_outputs.py "OCR用の画像\2026-06-09\sam-preview\top-crops-yomitoku-json" --out outputs/ocr-evaluation/top-crops-yomitoku-evaluation.json
```

出力:

```text
outputs/ocr-evaluation/top-crops-yomitoku-evaluation.json
outputs/ocr-evaluation/top-crops-yomitoku-evaluation.md
```

`data/ground_truth/<json-stem>.txt` を置くとCERを計算する。現状はground truthがないため、文字数、単語数、平均rec_score、平均det_score、低信頼単語を使うproxy評価になる。

## 2026-06-15時点の確認結果

- OCR worker常駐モードは `--watch --interval 1` で実装済み
- WebApp受信済み実画像4件はYomiToku OCR実行済み
- 3件は `pending_review / ocr.succeeded`
- 1件は `published / ocr.succeeded / publish.not_sent`
- 68バイトのsmoke用PNG 1件は `ocr.failed`
- `r2-pending-cards.json` は再生成カードPNGだけを送信待ちとして生成する
- 2026-06-15に `HCD-20260613-141847-A9UJ` のカードPNGを `hcd-memory-map` へ送信済み
- 評価用top crop 4件は全件テキスト抽出あり
- top crop 4件のproxy評価は `avgRecScore = 0.684`, `avgDetScore = 0.7411`
- このPCでは `torch 2.12.0+cu126`、CUDA利用可、GPUは `NVIDIA GeForce RTX 3090`

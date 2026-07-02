# 公開カードPNG R2パイプライン

作成日: 2026-06-15

## 方針

R2に公開する成果物は、レビュー済み本文から再生成した正方形PNGカードだけにする。

R2に送らないもの:

- 元の撮影画像
- crop画像
- OCR overlay画像
- record JSON
- OCR原文/レビュー本文のJSON
- 担当者名やローカルファイルパス

## Unity連携

Unity連携はファイル名から読む案Aを採用する。

R2 key:

```text
events/reitaku-hcd-2026/cards/<capturedAt>_<recordId>_h<contentHash>_<latitude>_<longitude>_<campus>.png
```

例:

```text
events/reitaku-hcd-2026/cards/20260613T141847Z_HCD-20260613-141847-A9UJ_h38349e923a78_35.833956_139.956178_inside.png
```

`<campus>` は末尾のキャンパス内外トークンで、`inside`（大学内）または `outside`（大学外）の小文字どちらか。Unityはこのファイル名からキャンパス内外を読む。このファイル名変更はUnity側で承認済み。

ファイル名に入れるもの:

- 撮影時刻 UTC: `YYYYMMDDTHHMMSSZ`
- record ID
- カード内容hash
- 緯度
- 経度
- キャンパス内外トークン: `inside` / `outside`（`campus = "unknown"` は公開ブロックのためファイル名に出ない）

ファイル名に入れないもの:

- 本文
- OCR原文
- ニックネーム
- 担当者名
- ジャンル

`contentHash` はレビュー後本文、表示名、ジャンル、撮影時刻、緯度経度から作る。送信失敗後の再送など、カード内容が変わっていない場合は同じkeyになるため、R2上にversion違いの同一PNGが増えない。レビュー本文や表示名を変更した場合はhashが変わり、新しいPNGになる。

## カード生成

```powershell
uv run python Codex-scripts\generate_memory_card.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --id HCD-20260613-141847-A9UJ --force
```

出力先:

```text
outputs/webapp-captures/reitaku-hcd-2026/generated-cards/
```

生成器はWindowsの日本語フォントを自動検出する。必要なら環境変数で指定できる。

```text
HCD_CARD_FONT_SERIF=
HCD_CARD_FONT_SANS=
HCD_CARD_FONT_SANS_BOLD=
```

## R2 dry-run

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --dry-run
```

dry-runは標準出力だけで送信予定を確認する。計画ファイルも残したい場合は `--write-plan` を付ける。

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --dry-run --write-plan
```

`r2-pending-cards.json` に出るR2 keyは `cards/*.png` だけであることを確認する。

## R2送信

wranglerログイン済みならS3秘密鍵なしで送信できる。

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev
```

S3互換キーを使う場合は以下を設定する。

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hcd-memory-map
R2_PREFIX=events/reitaku-hcd-2026
R2_PUBLIC_BASE_URL=https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev
```

アップロード成功時、recordの `publish` は以下のようになる。

- `publish.status = sent`
- `publish.cardKey = events/.../cards/*.png`
- `publish.publicImageUrl = https://...r2.dev/events/.../cards/*.png`
- `publish.originalKey = null`
- `publish.cropKey = null`
- `publish.recordKey = null`
- `publish.manifestKey = null`

## 重複cleanup

古い `v<record.version>` 形式や、同じrecordの重複PNGを整理する。

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --cleanup-duplicates --verify-public
```

cleanupで行うこと:

- 現在の公開済みrecordを `h<contentHash>` keyへ移行
- recordの `publish.cardKey` / `publicImageUrl` を新keyへ更新
- 同じrecordの古いR2 card keyを削除
- ローカル `generated-cards` の古いPNG/input JSONを削除

確認だけしたい場合:

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --cleanup-duplicates --dry-run
```

## R2常駐worker

承認済みrecordを自動でR2へ送る場合は、WebApp/OCR workerとは別のPowerShellでR2 workerを起動する。

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --watch --interval 1 --verify-public
```

workerが拾う対象:

- `status = published`
- `publish.status = not_sent`
- `review.excludeFromPublish` が `false`
- レビュー済み本文あり
- 緯度経度あり

既定では `publish.status = failed` は自動再試行しない。通信不調などで失敗分を再送したい場合だけ `--retry-failed` を付ける。

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --watch --interval 1 --verify-public --retry-failed
```

workerの安全装置:

- 多重起動防止: `<event output>/.r2-worker.lock`
- ログ: `<event output>/r2-worker.log`
- `Ctrl+C` で終了
- `--force` は `--watch` と併用不可
- `--verify-public` 使用時はR2アップロード後に公開URLの `HEAD` が `image/png` で返ることを確認してから `sent` にする

動作確認だけしたい場合:

```powershell
uv run python Codex-scripts\upload_records_to_r2.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --bucket hcd-memory-map --public-base-url https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev --dry-run --watch --interval 1 --max-loops 2
```

## 位置情報なしrecord

Unity案Aでは緯度経度がファイル名に必要なので、位置情報がないrecordはアップロード対象からブロックされる。

fixture生成だけしたい場合:

```powershell
uv run python Codex-scripts\generate_memory_card.py outputs\webapp-captures\reitaku-hcd-2026\manifest.json --id HCD-20260612-121502-CFEX --allow-missing-coordinates --out-dir outputs\card-generation-fixtures
```

このオプションは公開送信には使わない。

## 2026-06-15確認

- R2 bucket: `hcd-memory-map`
- Public r2.dev: `https://pub-6a157761d4194034a8b2b70f9e7a2bad.r2.dev`
- `HCD-20260613-141847-A9UJ` のカードPNGをアップロード済み
- 公開URLは `200` / `image/png`
- R2からダウンロードしたPNGを目視確認済み
- 旧形式のversionなしカードkeyは削除済み

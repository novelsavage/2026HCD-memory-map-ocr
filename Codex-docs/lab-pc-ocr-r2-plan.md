# 研究室PC OCR + Cloudflare R2連携計画

作成日: 2026-06-09

## 目的

HCD当日にスマホで撮影した付箋画像をOCRし、OCR結果と画像をCloudflare R2へ保存する。

現状では、X1 Carbon上のWebAppにスマホからCloudflare Tunnel経由でアクセスし、画像をX1へ保存できている。次段階として、研究室PCでWebApp/OCR処理を動かすべきか、X1を現地ハブとして残すべきかを整理する。

## 結論

研究室PCでWebAppを立ち上げ、そのままOCRしてR2へ保存する構成は可能。

ただし、本番運用では次の2案を比較する。

### 案A: 研究室PC直受け構成

```text
スマホ
  -> Cloudflare Tunnel URL
  -> 研究室PC WebApp
  -> 研究室PCでOCR
  -> Cloudflare R2へ保存
```

長所:

- X1を中継しなくてよい
- 撮影後すぐ研究室PCでOCRできる
- 研究室PCの計算資源を直接使える
- X1の性能やバッテリーに依存しない

短所:

- イベント現地から研究室PCまでの経路がインターネット/Tunnel依存になる
- 現地ネットが不安定だと撮影画像の送信に失敗する
- 研究室PCをChromeリモートデスクトップ等で監視する必要がある
- 現地で即座にトラブル対応しにくい

### 案B: X1現地キャッシュ + 研究室PC OCR構成

```text
スマホ
  -> Cloudflare Tunnel URL or local X1 URL
  -> X1 WebApp
  -> X1にローカル保存
  -> 研究室PCへ同期
  -> 研究室PCでOCR
  -> Cloudflare R2へ保存
```

長所:

- 現地で画像を確実にローカル保存できる
- ネットが不安定でも撮影データを失いにくい
- X1管理画面で受信状況を現地確認できる
- 研究室PC/OCR/R2送信は後から再実行できる

短所:

- X1から研究室PCへ同期する処理が必要
- 構成要素が増える

## 推奨

本番では案Bを推奨する。

理由:

- HCD当日の最優先は「付箋画像を失わないこと」
- OCRやR2アップロードは後から再実行できる
- 現地にX1があると、撮影状況・エラー・受信件数をその場で確認できる

ただし、事前テストや研究室内運用では案Aで十分。研究室PCにWebAppを置けば、スマホからCloudflare Tunnel URLを開いて直接撮影/OCR/R2保存まで一気通貫で確認できる。

## R2連携の基本方針

Cloudflare R2はS3互換APIを持つため、Pythonの `boto3` またはNode.jsのAWS SDKでアップロードできる。

R2の認証情報はブラウザに置かない。必ずサーバー側で使う。

安全な構成:

```text
Browser
  -> WebApp API
  -> server-side upload to R2
```

避ける構成:

```text
Browser
  -> direct R2 upload with Access Key / Secret
```

ブラウザから直接R2へアップロードする場合は、サーバー側で短時間有効のPresigned URLを発行してから使う。ただし初期実装ではサーバー側アップロードのほうが単純。

## R2に保存するもの

1付箋につき、最低限以下を保存する。

```text
events/reitaku-hcd-2026/
  captures/
    HCD-20260620-0001/original.jpg
    HCD-20260620-0001/crop.jpg
    HCD-20260620-0001/ocr-overlay.jpg
  records/
    HCD-20260620-0001.json
  manifests/
    manifest.json
```

`record.json` 例:

```json
{
  "id": "HCD-20260620-0001",
  "eventId": "reitaku-hcd-2026",
  "status": "pending_review",
  "operator": {
    "name": "staff-name",
    "location": "地図側",
    "deviceLabel": "Nothing phone 3a"
  },
  "memory": {
    "nickname": "",
    "genre": "unknown",
    "mapArea": "",
    "note": ""
  },
  "ocr": {
    "engine": "yomitoku",
    "status": "succeeded",
    "textRaw": "OCRで抽出したテキスト",
    "textReviewed": "",
    "ranAt": "2026-06-20T13:30:00+09:00"
  },
  "r2": {
    "originalKey": "events/reitaku-hcd-2026/captures/HCD-20260620-0001/original.jpg",
    "ocrOverlayKey": "events/reitaku-hcd-2026/captures/HCD-20260620-0001/ocr-overlay.jpg",
    "recordKey": "events/reitaku-hcd-2026/records/HCD-20260620-0001.json"
  }
}
```

## ステータス設計

```text
captured
  -> pending_ocr
  -> ocr_running
  -> pending_review
  -> approved
```

失敗:

```text
upload_failed
ocr_failed
r2_upload_failed
rejected
```

展示アプリは `approved` のみ読む。

## 実装案

### フェーズ1: 研究室PC単体でOCR

WebAppが保存した画像をOCRするCLIを作る。

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

処理:

- `manifest.json` を読む
- `status = captured` の画像を処理する
- YomiToku OCRを実行する
- OCR結果を `record.json` に追記する
- `status = pending_review` にする

### フェーズ2: R2アップロード

OCR済み画像とJSONをR2へアップロードする。

```powershell
uv run python Codex-scripts/upload_records_to_r2.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

必要な環境変数:

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=
```

R2 endpoint:

```text
https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
```

### フェーズ3: WebAppから自動OCR

研究室PCでWebAppを動かす場合、画像アップロード直後にOCRジョブを走らせる。

初期実装ではWebAppから直接OCRしない。まずCLIで確実に動かす。

理由:

- YomiTokuは重い
- Webリクエスト中にOCRするとタイムアウトやUI停止が起きやすい
- ジョブキュー化したほうが再実行しやすい

後続で、WebAppに「OCR実行」ボタンやバックグラウンドワーカーを追加する。

## X1を経由する必要があるか

### 経由しなくてよいケース

- 研究室PCが安定して動かせる
- Cloudflare Tunnel URLをメンバーへ共有できる
- 現地ネットからそのURLへ安定してアップロードできる
- 研究室PCを遠隔監視できる
- 多少の通信失敗を現地でリカバリできる

この場合:

```text
研究室PCだけでOK
```

### X1を残したほうがよいケース

- 現地ネットが不安定
- 画像を絶対に現地で保存したい
- 現地で受信状況を目視確認したい
- 研究室PCが落ちても撮影を続けたい
- 当日スタッフがX1画面で管理したい

この場合:

```text
X1 = 現地キャッシュ
研究室PC = OCR/R2ワーカー
```

## R2担当メンバーから必要な情報

最低限:

- R2 Account ID
- Bucket名
- Access Key ID
- Secret Access Key
- 保存先prefix
  - 例: `events/reitaku-hcd-2026/`
- 公開URLの方針
  - R2 public bucket
  - custom domain
  - private + signed URL

確認したいこと:

- 画像を公開表示するアプリはR2のどのURLを読むのか
- `record.json` もR2に置くのか、DBにも入れるのか
- 表示アプリ側で読むmanifest形式
- `approved` のレビューは誰がどこで行うのか

## 推奨する次の作業

1. 研究室PCでWebAppを起動し、Cloudflare Tunnel経由でスマホ撮影できるか確認
2. `process_webapp_captures.py` を作り、ローカル画像をOCRする
3. `record.json` にOCR結果を追記する
4. R2担当から認証情報と保存prefixをもらう
5. `upload_records_to_r2.py` を作る
6. R2に画像とJSONが保存されることを確認する
7. 表示アプリ側でR2上のJSON/画像を読めるか確認する

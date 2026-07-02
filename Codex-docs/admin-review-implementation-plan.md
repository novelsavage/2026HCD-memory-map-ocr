# 管理画面レビュー機能 本実装書

作成日: 2026-06-14

## 目的

`/admin/review-prototype` で固めたレビューUIを、実データ更新・OCR結果保存・承認時R2送信まで動く本実装へ移行する。

本実装のゴールは、スマホで撮影された付箋を自動OCRし、PC管理画面で人間が修正・承認し、承認済みデータだけをCloudflare R2上の公開manifestへ反映することである。

## 前提

- 現在のWebAppはローカル保存を正としている。
- 既存保存先は `outputs/webapp-captures/<eventId>/`。
- 既存 `CaptureRecord.status` は `captured | upload_failed`。
- レビューUIでは作業状態として `captured | pending_review | published` を使う。
- OCR失敗やR2送信失敗はメイン状態にせず、`ocr.status` / `publish.status` の補助状態で扱う。
- UIプロトタイプは見た目と操作感の基準として残し、本実装画面へ段階的に移植する。

## 実装方針

### 状態の考え方

メイン状態は人間の作業段階だけに絞る。

```ts
type CaptureStatus = "captured" | "pending_review" | "published";
```

表示名:

```text
captured        撮影済み
pending_review  レビュー待ち
published       公開済み
```

補助状態:

```ts
type OcrStatus = "not_run" | "running" | "succeeded" | "failed";
type PublishStatus = "not_sent" | "sending" | "sent" | "failed";
```

状態遷移:

```text
撮影
  -> status: captured
  -> OCR成功
  -> status: pending_review
  -> 管理画面で承認
  -> status: published
  -> R2送信
  -> publish.status: sent
```

OCR失敗時:

- `status` は原則 `captured` のまま。
- `ocr.status = "failed"` と `ocr.lastError` に記録する。
- 本文を手で入力できる場合は、管理者操作で `pending_review` に進められる余地を残す。

R2送信失敗時:

- `status = "published"` は維持する。
- `publish.status = "failed"` と `publish.lastError` に記録する。
- 再送信は後続APIで再実行できるようにする。

## データモデル

### `CaptureRecord` 拡張

[WebApp/src/lib/records.ts](../WebApp/src/lib/records.ts) の型を次の形へ拡張する。

```ts
export type CaptureStatus = "captured" | "pending_review" | "published";

export type OcrStatus = "not_run" | "running" | "succeeded" | "failed";

export type PublishStatus = "not_sent" | "sending" | "sent" | "failed";

export type CaptureRecord = {
  id: string;
  eventId: string;
  status: CaptureStatus;
  operator: {
    name: string;
    location: string;
    deviceLabel: string;
  };
  memory: {
    nickname: string;
    genre: string;
    mapArea: string;
    note: string;
    era: string;
    latitude: string;
    longitude: string;
  };
  capture: {
    originalName: string;
    storedFileName: string;
    localImagePath: string;
    receivedAt: string;
    size: number;
    mimeType: string;
    crop?: {
      originalName: string;
      storedFileName: string;
      localImagePath: string;
      size: number;
      mimeType: string;
      aspectRatio: "5:3";
      sourceRect?: CropRect;
      guideRect?: CropRect;
    };
  };
  ocr: {
    engine: "yomitoku";
    status: OcrStatus;
    textRaw: string;
    textReviewed: string;
    ranAt: string | null;
    inputImagePath: string | null;
    overlayImagePath: string | null;
    lastError: string | null;
  };
  review: {
    reviewedAt: string | null;
    reviewedBy: string;
    note: string;
    excludeFromPublish: boolean;
  };
  publish: {
    status: PublishStatus;
    sentAt: string | null;
    bucket: string;
    prefix: string;
    originalKey: string | null;
    cropKey: string | null;
    recordKey: string | null;
    manifestKey: string | null;
    publicImageUrl: string | null;
    lastError: string | null;
  };
  sync: {
    labPcSent: boolean;
    cloudUploaded: boolean;
    lastError: string | null;
  };
};
```

### 既存JSON互換

既存 `records/*.json` は `ocr`, `review`, `publish` を持っていないため、読み込み時に正規化する。

`listCaptureRecords()` で `JSON.parse` 直後に `normalizeCaptureRecord(parsed)` を通す。

正規化ルール:

- `status === "upload_failed"` は `captured` に寄せ、`sync.lastError` に既存エラーを残す。
- `ocr` がなければ `not_run` で初期化する。
- `review` がなければ空で初期化する。
- `publish` がなければ `not_sent` で初期化する。
- `memory.genre` が空なら `unknown`。
- `sync` がなければ現行互換の空値で初期化する。

この互換層を入れることで、過去に撮影済みのJSONを一括マイグレーションしなくても管理画面を開ける。

### レコード更新関数

`records.ts` に次を追加する。

```ts
export async function getCaptureRecord(id: string): Promise<CaptureRecord | null>
export async function writeCaptureRecord(record: CaptureRecord): Promise<CaptureRecord>
export async function updateCaptureRecord(
  id: string,
  update: (record: CaptureRecord) => CaptureRecord
): Promise<CaptureRecord>
```

`writeCaptureRecord()` は `records/<id>.json` を保存した後、通常manifestを再生成する。

## Manifest

### ローカル管理manifest

既存の `outputs/webapp-captures/<eventId>/manifest.json` は全件管理用として残す。

含めるもの:

- `captured`
- `pending_review`
- `published`
- R2送信失敗レコード
- OCR失敗レコード

用途:

- 管理画面
- OCR CLI
- 再送信CLI
- トラブル復旧

### 公開manifest

展示アプリ/Unity向けには別ファイルを作る。

ローカル:

```text
outputs/webapp-captures/<eventId>/public-manifest.json
```

R2:

```text
events/<eventId>/manifests/manifest.json
```

含める条件:

```ts
record.status === "published" &&
record.publish.status === "sent" &&
!record.review.excludeFromPublish
```

公開manifestの1件あたりの推奨形:

```json
{
  "id": "HCD-20260614-120000-ABCD",
  "text": "レビュー後本文",
  "textRaw": "OCR原文",
  "nickname": "ra-yu",
  "genre": "友情",
  "era": "2025",
  "latitude": 35.833956,
  "longitude": 139.956178,
  "imageUrl": "https://...",
  "receivedAt": "2026-06-14T12:00:00.000Z",
  "reviewedAt": "2026-06-14T12:05:00.000Z"
}
```

`text` は `ocr.textReviewed` を優先し、空なら `memory.note`、それも空なら `ocr.textRaw` を使う。ただし承認時には空本文をエラーにする。

## API設計

### 既存API

```text
GET  /api/records
POST /api/captures
GET  /api/captures/[fileName]
```

### 追加API

初期本実装では、APIを増やしすぎず次の2系統にする。

```text
PATCH /api/records/[id]
POST  /api/records/[id]/actions
```

#### `PATCH /api/records/[id]`

レビュー画面の保存ボタンで使う。

更新対象:

- `ocr.textReviewed`
- `memory.nickname`
- `memory.genre`
- `memory.era`
- `memory.latitude`
- `memory.longitude`
- `review.note`
- `review.excludeFromPublish`

リクエスト例:

```json
{
  "ocr": {
    "textReviewed": "修正済み本文"
  },
  "memory": {
    "nickname": "ra-yu",
    "genre": "友情",
    "era": "2025",
    "latitude": "35.833956",
    "longitude": "139.956178"
  },
  "review": {
    "note": "",
    "excludeFromPublish": false
  }
}
```

レスポンス:

```json
{
  "ok": true,
  "record": {}
}
```

バリデーション:

- `genre` は許可リスト内、または `unknown`。
- `era` は許可年代内、または空。
- `latitude` / `longitude` は空文字または数値文字列。
- 本文は長すぎる場合に上限を設ける。初期値は2000文字程度。

#### `POST /api/records/[id]/actions`

承認、再送信、手動レビュー送りなどの状態変更で使う。

```json
{ "action": "approve-and-publish" }
```

```json
{ "action": "republish" }
```

```json
{ "action": "mark-pending-review" }
```

初期実装で必須:

- `approve-and-publish`
- `republish`

後回しでよい:

- `run-ocr`
- `mark-pending-review`
- `exclude-from-publish`

### 承認APIの処理順

`approve-and-publish` は次の順で処理する。

1. リクエスト本文で渡されたレビュー本文・メタデータがあれば先に保存する。
2. 本文が空なら400を返す。
3. `status = "published"` に更新する。
4. `review.reviewedAt` と `review.reviewedBy` を入れる。
5. `publish.status = "sending"` にして保存する。
6. R2へ画像とrecord JSONをアップロードする。
7. 成功したら `publish.status = "sent"`、各R2 key、`sentAt` を保存する。
8. 失敗したら `publish.status = "failed"`、`lastError` を保存する。
9. 公開manifestを再生成し、R2へアップロードする。
10. 最新recordを返す。

R2送信に失敗しても `status = "published"` は戻さない。

## R2実装

### 環境変数

`.env.local` に置く。Gitには入れない。

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hcd-memory-map
R2_PREFIX=events/reitaku-hcd-2026
R2_PUBLIC_BASE_URL=
```

`R2_PUBLIC_BASE_URL` は公開URLを組み立てるために使う。public bucketまたはcustom domainの方針が決まるまで空でもよい。

### 保存キー

```text
<R2_PREFIX>/captures/<id>/original.jpg
<R2_PREFIX>/captures/<id>/crop.jpg
<R2_PREFIX>/captures/<id>/ocr-overlay.jpg
<R2_PREFIX>/records/<id>.json
<R2_PREFIX>/manifests/manifest.json
```

### 実装ファイル案

```text
WebApp/src/lib/r2.ts
```

責務:

- R2クライアント生成
- `putObject`
- `uploadRecordAssets(record)`
- `uploadPublicManifest(manifest)`
- R2未設定時の明確なエラー

R2未設定時:

- 管理画面は開ける。
- 承認APIは `publish.status = "failed"` にし、`lastError = "R2 is not configured"` を残す。
- 開発中にR2なしでレビュー保存だけ試せる。

## OCR実装

### 初期方針

Webリクエスト内でYomiTokuを直接実行しない。

理由:

- OCRは重い。
- リクエストタイムアウトやUI停止を避けたい。
- 失敗時に再実行しやすいCLI/ワーカーのほうが安全。

### CLI

```text
Codex-scripts/process_webapp_captures.py
```

コマンド例:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

処理:

1. `manifest.json` を読む。
2. `status = captured` かつ `ocr.status in ("not_run", "failed")` のrecordを対象にする。
3. `capture.crop` があればcrop画像を優先する。
4. YomiTokuを実行する。
5. OCRテキストを `ocr.textRaw` に保存する。
6. `ocr.textReviewed` が空なら `textRaw` で初期化する。
7. `ocr.status = "succeeded"` にする。
8. `status = "pending_review"` にする。
9. 可視化画像が得られる場合は `ocr.overlayImagePath` に保存する。
10. レコードJSONと管理manifestを再生成する。

失敗時:

- `ocr.status = "failed"`
- `ocr.lastError` にエラー文字列
- `status = "captured"` 維持

### 後続の自動化

初期CLIが安定したら、次のどちらかへ進む。

案A:

- 管理画面に「OCRキュー実行」ボタンを追加する。
- APIからCLI/ワーカーを起動する。

案B:

- 常駐ワーカーを作る。
- `records` を定期監視し、未OCRを自動処理する。

当日運用では案Bが望ましい。ただし最初は手動CLIで十分。

## 管理画面実装

### 画面構成

プロトタイプ:

```text
/admin/review-prototype
```

本実装:

```text
/admin/review
```

最終的に `/admin` から `/admin/review` へ導線を置く。

### コンポーネント移行

現在のプロトタイプ:

```text
WebApp/src/components/admin-review-prototype.tsx
```

本実装では次へ分割する。

```text
WebApp/src/components/admin-review-board.tsx
WebApp/src/components/admin-review-card.tsx
WebApp/src/components/admin-review-panel.tsx
WebApp/src/components/admin-review-badges.tsx
```

初期実装では1ファイルのままでもよいが、API接続後に肥大化するため分割を推奨する。

### UI動作

保存:

- `PATCH /api/records/[id]`
- 成功後、ローカルstateの該当recordを更新する。

承認して公開:

- `POST /api/records/[id]/actions`
- `action = "approve-and-publish"`
- 成功後、対象カードを `published` 列へ移動する。
- 次の `pending_review` カードを自動選択する。

再送信:

- 初期UIでは公開済みカードにボタンを置かない方針。
- ただし `publish.status = failed` のカードには、後続で小さな再送信導線を追加できる。

### 楽観更新

初期実装は楽観更新しすぎない。

推奨:

- 保存ボタンは `saving` 表示。
- 承認ボタンは `sending` 表示。
- API成功後にstate更新。
- API失敗時はトーストまたは画面上部アラートで表示。

理由:

- record JSONが正本。
- R2送信失敗など複数段階の失敗がある。

### 画面更新方針

管理画面の通常操作では、F5などの手動更新を前提にしない。

基本方針:

- 自分が保存・承認した変更は、API成功後すぐ画面stateへ反映する。
- 他の端末・他のレビュワーによる変更は、短い間隔の自動再取得で追従する。
- 編集中のレビュー本文は勝手に上書きしない。
- レコードJSONの正本は常にサーバー側ファイルとする。

初期実装ではSSEやWebSocketではなく、ポーリングで十分とする。

推奨:

```text
GET /api/records?since=<lastKnownUpdatedAt>
```

または初期段階では単純に次でよい。

```text
GET /api/records
```

ポーリング間隔:

```text
レビュー画面が表示中: 5秒
ブラウザタブが非表示: 30秒
保存/承認直後: 即時再取得
```

画面反映ルール:

- 未編集のカードは、再取得結果でそのまま更新する。
- 現在選択中で編集中のカードは、入力欄を上書きしない。
- ただし、外部変更が検知されたら「他のユーザーが更新しました」表示を出す。
- 承認済みに移動したカードは、カンバン列を即時移動する。
- `publish.status` が `sending` から `sent` / `failed` へ変わったらバッジを更新する。

実装案:

```ts
useEffect(() => {
  const timer = window.setInterval(refreshRecords, 5000);
  return () => window.clearInterval(timer);
}, []);
```

`document.visibilityState` を見て、非表示時は間隔を長くする。

### 複数人レビュー時の方針

Cloudflare Tunnel越しに外部ラップトップから管理画面を開く場合、複数人が同時にレビューする可能性がある。

初期本実装では、厳密なリアルタイム共同編集ではなく、ファイル更新時刻を使った楽観ロックで競合を防ぐ。

`CaptureRecord` に次を追加する。

```ts
version: number;
updatedAt: string;
lockedBy?: string | null;
lockedAt?: string | null;
```

最低限必須:

- `version`
- `updatedAt`

任意だがあると便利:

- `lockedBy`
- `lockedAt`

更新APIでは、クライアントが最後に読んだ `version` を送る。

```json
{
  "version": 3,
  "ocr": {
    "textReviewed": "修正済み本文"
  }
}
```

サーバー側の現在versionと一致しない場合は、409 Conflictを返す。

```json
{
  "ok": false,
  "error": "record_conflict",
  "message": "この付箋は他のユーザーにより更新されています。",
  "record": {}
}
```

UI挙動:

- 409を受けたら保存・承認は失敗扱いにする。
- 最新recordを表示し、「自分の入力を残す / 最新に更新する」を選べるようにする。
- 初期実装では、自分の入力をローカルに残したままアラートを出すだけでもよい。

レビュー中の衝突を減らすため、カード選択時に軽いロック表示を使う。

```text
カード選択
  -> PATCH /api/records/[id] { lock: { lockedBy, lockedAt } }
  -> 他ユーザー画面では「編集中: レビュワー」バッジ表示
```

ただしロックは強制排他にしない。

理由:

- ブラウザを閉じ忘れた場合に作業が止まる。
- Cloudflare Tunnel経由では接続断があり得る。
- 当日運用では、警告表示 + 楽観ロックのほうが復旧しやすい。

ロックの有効期限:

```text
lockedAt から5分以上経過したら期限切れとして扱う
```

承認時の競合ルール:

- すでに `published` のrecordを承認しようとした場合は、APIは200で最新recordを返してよい。
- `version` が古い状態で承認した場合は409にする。
- 他人が本文を更新した直後の承認は、最新内容を確認してから再実行させる。

### 推奨する初期実装レベル

最初からWebSocket/SSEを入れない。

フェーズ2から入れるもの:

- `version`
- `updatedAt`
- PATCH/actions APIでの409 Conflict
- 保存/承認成功後の即時state更新
- 5秒ポーリング

フェーズ3以降で入れるもの:

- `lockedBy`
- `lockedAt`
- カード上の「編集中」バッジ
- 競合時の差分表示

これで、1人レビューではF5不要、2人以上レビューでも上書き事故をかなり減らせる。

## 実装順

### フェーズ1: 型と互換正規化

対象:

- [WebApp/src/lib/records.ts](../WebApp/src/lib/records.ts)

作業:

- `CaptureStatus` を `captured | pending_review | published` に変更。
- `OcrStatus`, `PublishStatus` を追加。
- `CaptureRecord` に `ocr`, `review`, `publish` を追加。
- `version`, `updatedAt` を追加。
- `normalizeCaptureRecord()` を追加。
- `listCaptureRecords()` で正規化する。
- `saveCaptureRecord()` で新規recordに初期 `ocr/review/publish` を入れる。

確認:

```powershell
cd WebApp
npm run build
```

### フェーズ2: レコード更新API

対象:

```text
WebApp/src/app/api/records/[id]/route.ts
WebApp/src/app/api/records/[id]/actions/route.ts
WebApp/src/lib/records.ts
```

作業:

- `GET /api/records/[id]`
- `PATCH /api/records/[id]`
- `POST /api/records/[id]/actions`
- レコード保存後に管理manifest再生成。
- 承認APIはR2未実装でも `published` へ進められる形にする。
- `version` 不一致時は409 Conflictを返す。

確認:

- PowerShellの `Invoke-RestMethod` でPATCHできる。
- JSONファイルが更新される。
- manifestが再生成される。

### フェーズ3: レビュー画面を実API接続

対象:

```text
WebApp/src/app/admin/review/page.tsx
WebApp/src/components/admin-review-board.tsx
```

作業:

- プロトタイプUIを本画面へ移植。
- `sampleOcrText()` を廃止し、`record.ocr.textRaw` を表示。
- 編集欄は `record.ocr.textReviewed` を使う。
- 保存ボタンをPATCHへ接続。
- 承認ボタンをactions APIへ接続。
- 5秒ポーリングで他端末の変更を反映。
- 編集中の入力欄はポーリングで上書きしない。
- エラー表示とローディング表示を追加。

確認:

- 保存でrecord JSONが変わる。
- 承認で `status = published` になる。
- 次のレビュー待ちカードが選択される。

### フェーズ4: OCR CLI

対象:

```text
Codex-scripts/process_webapp_captures.py
```

作業:

- manifest読み込み。
- record JSON読み書き。
- crop優先でYomiToku実行。
- `ocr.textRaw` / `ocr.textReviewed` / `status` 更新。
- 管理manifest再生成。

確認:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

### フェーズ5: R2送信

対象:

```text
WebApp/src/lib/r2.ts
WebApp/src/lib/public-manifest.ts
WebApp/src/app/api/records/[id]/actions/route.ts
```

作業:

- R2クライアント実装。
- `approve-and-publish` から画像・record JSONをアップロード。
- 公開manifest生成。
- R2へ公開manifestをアップロード。
- 送信失敗時の `publish.status = failed`。

確認:

- R2上に画像、record JSON、manifestが作成される。
- R2未設定時も管理画面が壊れない。

### フェーズ6: 管理画面統合

対象:

```text
WebApp/src/app/admin/page.tsx
WebApp/src/components/admin-dashboard.tsx
```

作業:

- `/admin/review` への導線追加。
- 管理画面にレビュー待ち件数、公開済み件数、送信失敗件数を表示。
- プロトタイプ導線は必要なら `Codex-docs` 参照に留める。

## テスト観点

### ビルド

WebApp変更後は必ず実行する。

```powershell
cd WebApp
npm run build
```

### lint

現状、既存 `capture-form.tsx` のrefsルール違反で失敗する。

レビュー本実装時に別途修正するか、少なくとも新規ファイルにlintエラーを増やさない。

```powershell
cd WebApp
npm run lint
```

### 手動確認

1. スマホまたはブラウザから1件送信する。
2. `outputs/webapp-captures/<eventId>/records/<id>.json` が作られる。
3. OCR CLIで `pending_review` になる。
4. `/admin/review` でカードがレビュー待ちに出る。
5. レビュー後本文を編集して保存する。
6. JSONに反映される。
7. 承認して公開する。
8. `status = published` になる。
9. R2設定済みなら `publish.status = sent` になる。
10. 公開manifestに含まれる。

### 失敗系確認

- R2環境変数なしで承認する。
- `publish.status = failed` になり、画面に送信失敗バッジが出る。
- OCR CLIでYomiTokuが失敗した場合に `ocr.status = failed` が保存される。
- 既存の古いrecord JSONでも `/admin/review` が開ける。

## 実装時の注意

- R2秘密鍵は `.env.local` のみに置き、Gitに入れない。
- ブラウザへR2 Access Key / Secretを渡さない。
- 画像受信処理はローカル保存を最優先し、R2/OCR失敗で撮影データを失わない。
- record JSONを更新したら管理manifestを再生成する。
- 公開manifestは管理manifestと分ける。
- `published` は人間レビュー完了を表し、R2送信成功そのものではない。
- OCR原文は上書きせず、レビュー後本文を別フィールドに保存する。
- プロトタイプの見た目を尊重するが、実装ではAPI失敗時の表示を必ず入れる。

## 推奨コミット分割

1. `CaptureRecord` 型拡張と正規化。
2. record更新API。
3. `/admin/review` 実API接続。
4. OCR CLI。
5. R2アップロードと公開manifest。
6. `/admin` 統合と運用表示。

この順なら、各段階でビルド確認しやすく、途中で止めても撮影・ローカル保存機能を壊しにくい。

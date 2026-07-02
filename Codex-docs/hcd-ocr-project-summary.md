# HCD付箋OCRプロジェクト総まとめ

作成日: 2026-06-10

## 目的

HCD Home Coming Dayで、参加者が物理的な付箋に書いた思い出をスマホで撮影し、画像とOCR結果を保存する。保存したデータは、別メンバーが担当する思い出マップ系アプリケーションから読み込める形にする。

最終的に扱いたいデータは次の通り。

- 付箋の元画像
- 必要なら付箋部分だけのトリミング画像
- OCR結果テキスト
- OCR結果を確認できるオーバーレイ画像
- 撮影者、撮影場所、端末名などの運用メタデータ
- 展示アプリが読むためのJSONまたはmanifest

## 現在できていること

Next.js製の撮影WebAppを `WebApp/` に作成済み。

主な画面:

- `/`: スマホ・スタッフ向け撮影画面
- `/admin`: 管理画面

スマホ側では、Webページ内でカメラを起動して撮影し、画像をWebAppへ送信できる。カメラがうまく動かない端末では、ファイル選択フォールバック経由でスマホのカメラアプリを使える。

ローカル保存先:

```text
outputs/webapp-captures/reitaku-hcd-2026/
  captures/
  records/
  manifest.json
```

実際に複数の撮影データが保存されていることを確認済み。

Cloudflare Tunnel経由でスマホからアクセスし、撮影・送信できることも確認済み。スマホのブラウザでは `https://xxxxx.trycloudflare.com` 経由で開くため、カメラ権限が使える。

## これまでに試したこと

### IP Webcam方式

最初はAndroidのIP Webcamアプリを使い、スマホ映像をPC側で読み取ってOCRする案を検討した。既存の `C:\Users\Mori\Documents\nothing-camera-test` も参考にした。

ただし、以下の課題があった。

- iPhoneユーザーが同じ方式を使えるとは限らない
- Android側のIPアドレスが変わる
- シャッター操作がX1側に集中すると、複数スタッフのUXが悪い
- 複数スマホを安定して並列管理するには仕組みが重くなる

そのため、各スマホがブラウザで同じWebAppを開き、自分で撮影・送信する方式に切り替えた。

### X1ローカルHTTPS

スマホブラウザでカメラを使うには、HTTPSまたはlocalhost相当の安全なコンテキストが必要だった。

`mkcert` とNext.jsの `--experimental-https` を使ってX1のIPアドレス向け証明書を試したが、スマホ側の証明書信頼や `ERR_CERT_COMMON_NAME_INVALID` などの問題があり、運用がやや不安定だった。

### Cloudflare Tunnel

Cloudflare Tunnelで `localhost:3000` をHTTPS公開する方式に切り替えた。

開発用のQuick Tunnel:

```powershell
cloudflared tunnel --url http://localhost:3000
```

この方式では `https://xxxxx.trycloudflare.com` のようなURLが発行される。スマホでこのURLを開くと、HTTPS扱いになるためカメラ起動が安定した。

注意点として、`npm run dev` ではCloudflare Tunnel越しのスマホで画面の一部が固まることがあった。最終的に次の本番モード起動で安定した。

```powershell
cd C:\Projects\OCR\WebApp
npm run build
npm run start
```

## Cloudflare R2の現状

Cloudflare R2を有効化し、バケットを作成済み。

バケット名:

```text
hcd-memory-map
```

疎通テストとして、リモートR2へ次のオブジェクトをアップロードし、取得できることを確認済み。

```text
events/reitaku-hcd-2026/system/smoke-test.json
```

内容:

```json
{"project":"hcd-memory-map","status":"ok","createdBy":"codex"}
```

Wranglerは `wrangler` 単体ではPATHにいない場合があるため、現状は次のように `npx wrangler` で実行する。

```powershell
npx wrangler r2 bucket list
npx wrangler r2 object put hcd-memory-map/events/reitaku-hcd-2026/system/smoke-test.json --file Codex-scripts\r2-smoke-test.json --remote
```

重要: `wrangler r2 object put` は、環境によってデフォルトがlocalになる。実際のCloudflare R2へ入れるときは `--remote` を付ける。

## 採用する本番構成

当面はCloudflare Pagesへ移行せず、現在動いているWebAppを活かす。ホスト先はX1ではなく、演算資源が使える研究室PCを本体にする。

採用構成:

```text
スマホ複数台
  -> Cloudflare TunnelのHTTPS URL
  -> 研究室PCのNext.js WebApp
  -> 研究室PCローカルへ保存
  -> Cloudflare R2へアップロード
  -> 研究室PCでOCR
  -> OCR結果と派生画像をR2へ保存
```

X1の役割:

```text
X1
  - 現地で管理画面を見る
  - Chromeリモートデスクトップで研究室PCを監視
  - Tailscale/SSHで研究室PCをメンテ
  - 研究室PCが使えない場合の予備サーバー
```

研究室PCの役割:

```text
研究室PC
  - Next.js WebAppを起動する
  - Cloudflare Tunnelを張る
  - 画像をローカルに一時保存する
  - R2へ画像とJSONを保存する
  - OCR処理を実行する
```

この構成の理由:

- 今すでに動いているWebAppを大きく壊さない
- 研究室PCの計算資源をOCRに使える
- スマホ側はHTTPS URLを開くだけでよい
- R2を正本ストレージにしつつ、研究室PCローカルにもキャッシュを残せる
- Cloudflare Pages化より実装リスクが低い

## Cloudflare Pagesを採用しない理由

Cloudflare Pagesを使うと、独自ドメインなしでも `pages.dev` の固定HTTPS URLを無料で持てる可能性がある。

しかし、今回のWebAppは現在ローカルファイル保存を前提にしている。Pagesへ移行すると、APIをCloudflare Pages Functions/Workers向けに直し、R2バインディングを使う構成へ変える必要がある。

その場合の構成:

```text
スマホ
  -> Cloudflare Pages
  -> R2
  -> 研究室PC OCRワーカー
```

設計としては綺麗だが、イベント前に実装変更が大きくなる。今回のHCDでは、研究室PCホスト + Cloudflare Tunnel + R2保存のほうが現実的。

## データ保存方針

R2を正本ストレージとして扱う。ただし、研究室PCにもローカルキャッシュを残す。

R2の推奨構造:

```text
events/reitaku-hcd-2026/
  captures/
    <id>/
      original.jpg
      crop.jpg
      ocr-overlay.jpg
  records/
    <id>.json
  manifests/
    manifest.json
  system/
    smoke-test.json
```

ローカル側の既存構造:

```text
outputs/webapp-captures/reitaku-hcd-2026/
  captures/
    HCD-YYYYMMDD-HHMMSS-XXXX.jpg
  records/
    HCD-YYYYMMDD-HHMMSS-XXXX.json
  manifest.json
```

初期実装では、ローカル構造を維持しつつ、同じ内容をR2へ同期する。

## レコードJSON案

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
  "capture": {
    "originalName": "hcd-capture.jpg",
    "storedFileName": "HCD-20260620-0001.jpg",
    "localImagePath": "captures/HCD-20260620-0001.jpg",
    "receivedAt": "2026-06-20T13:00:00+09:00",
    "size": 200000,
    "mimeType": "image/jpeg"
  },
  "ocr": {
    "engine": "yomitoku",
    "status": "succeeded",
    "textRaw": "OCRで抽出した文字",
    "textReviewed": "",
    "ranAt": "2026-06-20T13:01:00+09:00"
  },
  "r2": {
    "bucket": "hcd-memory-map",
    "originalKey": "events/reitaku-hcd-2026/captures/HCD-20260620-0001/original.jpg",
    "cropKey": "events/reitaku-hcd-2026/captures/HCD-20260620-0001/crop.jpg",
    "ocrOverlayKey": "events/reitaku-hcd-2026/captures/HCD-20260620-0001/ocr-overlay.jpg",
    "recordKey": "events/reitaku-hcd-2026/records/HCD-20260620-0001.json"
  },
  "sync": {
    "cloudUploaded": true,
    "lastError": null
  }
}
```

## ステータス設計

通常フロー:

```text
captured
  -> pending_ocr
  -> ocr_running
  -> pending_review
  -> approved
```

失敗系:

```text
upload_failed
ocr_failed
r2_upload_failed
rejected
```

展示アプリは、基本的に `approved` のデータだけ読む。

## 料金感

HCD規模では、R2の無料枠内に収まる可能性が高い。

考え方:

- 付箋2,000枚
- 1枚あたり元画像、切り抜き、OCR画像、JSONで平均2MB
- 合計約4GB

Cloudflare R2は、無料枠にストレージ、読み書き操作、egressが含まれる。大量アクセスや長期保存をしなければ、今回の用途では大きな費用リスクは低い。

ただし、正確な料金はCloudflareの最新料金ページを確認する。

## 運用手順案

### 研究室PCでWebApp起動

PowerShell 1:

```powershell
cd C:\Projects\OCR\WebApp
npm run build
npm run start
```

ローカル確認:

```text
http://localhost:3000
http://localhost:3000/admin
```

### Cloudflare Tunnel起動

PowerShell 2:

```powershell
cloudflared tunnel --url http://localhost:3000
```

表示されたURLをスタッフ全員に共有する。

```text
https://xxxxx.trycloudflare.com
```

複数スマホは同じURLを開いてよい。

### X1から監視

X1では以下のどちらかで研究室PCを監視する。

- Chromeリモートデスクトップ
- Tailscale + SSH

現地スタッフは `/admin` を見て、受信件数やエラーを確認する。

## 未実装タスク

### 1. WebAppからR2へアップロード

現在のWebAppはローカル保存まで実装済み。次に、画像受信時にR2へも保存する。

やること:

- Node.jsからR2へアップロードする実装を追加
- R2の認証情報を `.env.local` に置く
- `record.json` にR2キーを追記
- R2アップロード失敗時もローカル保存は残す

必要になりそうな環境変数:

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hcd-memory-map
R2_PREFIX=events/reitaku-hcd-2026
```

注意: Access Key IDとSecret Access Keyはブラウザに渡さない。必ずサーバー側だけで使う。

### 2. OCR処理CLI

研究室PCで、ローカルまたはR2上の未処理画像をOCRするCLIを作る。

初期案:

```powershell
uv run python Codex-scripts/process_webapp_captures.py outputs/webapp-captures/reitaku-hcd-2026/manifest.json
```

処理内容:

- `status = captured` または `pending_ocr` の画像を読む
- YomiTokuでOCR
- OCRテキストをrecord JSONへ追記
- 必要ならOCR画像や付箋トリミング画像を作成
- R2へ結果をアップロード
- `status = pending_review` に更新

### 3. レビューUI

OCRは手書き付箋なので誤認識が起きる。展示アプリへ出す前に、確認・修正するUIが必要。

最低限:

- 元画像を見る
- OCR結果を見る
- 修正テキストを入力する
- `approved` にする
- 読めないものは `rejected` にする

### 4. manifest公開方針

別アプリが読むためのmanifest形式を決める。

候補:

```text
events/reitaku-hcd-2026/manifests/manifest.json
```

展示アプリ側は、このmanifestから `approved` のみ読み込む。

## 重要な判断

今回のHCDでは、まず動いている構成を活かす。

採用:

```text
研究室PCホスト
Cloudflare Tunnel
スマホWebカメラ撮影
ローカル保存
R2正本保存
研究室PC OCR
```

今回は見送る:

```text
Cloudflare Pages完全移行
独自ドメイン前提の固定Tunnel URL
スマホIPカメラ方式
ブラウザへR2秘密鍵を持たせる構成
```

## 関連ファイル

WebApp:

```text
WebApp/
```

主な実装:

```text
WebApp/src/components/capture-form.tsx
WebApp/src/components/admin-dashboard.tsx
WebApp/src/app/api/captures/route.ts
WebApp/src/app/api/records/route.ts
WebApp/src/lib/records.ts
```

既存ドキュメント:

```text
Codex-docs/sticky-note-ocr-plan.md
Codex-docs/x1-local-webapp-plan.md
Codex-docs/x1-webapp-ui-plan.md
Codex-docs/lab-pc-ocr-r2-plan.md
Codex-docs/yomitoku-quickstart.md
```

R2テストファイル:

```text
Codex-scripts/r2-smoke-test.json
Codex-scripts/r2-smoke-test-downloaded.json
```

## 次にやること

次の実装ステップは、WebAppの画像受信APIにR2アップロードを足すこと。

優先順位:

1. R2 Access Keyを作成する
2. `.env.local` にR2認証情報を入れる
3. WebAppにR2アップロード処理を追加する
4. 画像送信時にローカル保存とR2保存の両方を行う
5. 管理画面でR2アップロード状態を表示する
6. OCR CLIを作成する
7. OCR結果をR2へ保存する

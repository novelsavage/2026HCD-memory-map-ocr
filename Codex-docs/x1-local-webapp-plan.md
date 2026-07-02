# X1 Carbon 現地ハブWebアプリ計画

作成日: 2026-06-07

## 目的

HCD Home Coming Day 当日に、X1 Carbon を現地ハブとして使う。メンバーは自分のスマホのブラウザからX1上のWebアプリにアクセスし、スマホカメラで付箋を撮影して送信する。

X1は撮影画像を受け取り、ローカル保存し、研究室PCまたはクラウド側のOCRワーカーへ渡す。X1のキーボード操作だけに依存しないことで、メンバーごとの作業UXを改善する。

## 結論

`WebApp/` ディレクトリを作り、Next.jsで現地用Webアプリを作る方針でよい。

```text
C:\Projects\OCR\
  WebApp\
    package.json
    next.config.ts
    app\
    src\
  Codex-scripts\
    sticky_note_ocr.py
    multi_phone_sticky_ocr.py
  Codex-docs\
  outputs\
```

ただし、OCR Pythonプロジェクトとは依存関係を分ける。

- OCR側: `uv` / Python / OpenCV / YomiToku
- WebApp側: `npm` または `pnpm` / Next.js / React

WebAppはプロジェクトルート直下に置くが、生成物や設計メモは既存ルールどおり `Codex-docs/` に置く。

## 全体フロー

```text
member smartphone
  -> browser opens X1 local WebApp
  -> camera capture via browser
  -> upload image to X1

X1 Carbon WebApp
  -> save image locally
  -> create capture record
  -> show queue/status dashboard
  -> send image/job to lab PC or cloud

lab PC OCR worker
  -> pull image/job
  -> OCR
  -> upload text/images to cloud storage/DB

review app
  -> pending_review data
  -> approve/reject

display app
  -> approved data only
```

## なぜIP Webcam方式からWebApp方式へ寄せるか

IP Webcam方式:

- 長所: スマホ映像をX1側で一括プレビューできる
- 短所: Android/iPhoneでアプリが分かれる
- 短所: スマホIPアドレスが変わる
- 短所: シャッター操作がX1担当者に集中しやすい

WebApp方式:

- 長所: Android/iPhoneの両方でブラウザから使える
- 長所: メンバー本人が自分のスマホで撮影できる
- 長所: スマホのIPアドレスをX1が知る必要がない
- 長所: 送信済み/未送信の状態をスマホ画面に出せる
- 短所: ブラウザのカメラ権限とHTTPS制約に注意が必要

HCD本番のUXを考えると、WebApp方式を主運用にし、IP Webcam方式は管理者用・予備用にする。

## 重要な技術注意点

スマホブラウザでカメラを使う `getUserMedia()` は、基本的にセキュアコンテキストが必要。

許可されやすい例:

- `https://...`
- `http://localhost`

スマホから `http://x1-ip:3000` にアクセスする場合、環境によってカメラAPIが使えない可能性がある。

そのため、次のどちらかを事前検証する。

### 案A: HTTPSローカル開発サーバー

X1でNext.jsをHTTPS起動し、スマホからアクセスする。

課題:

- 自己署名証明書をスマホ側で信頼させる必要がある
- iPhoneは証明書まわりが少し面倒

### 案B: 一時公開トンネル

Cloudflare Tunnel、ngrok、Tailscale FunnelなどでHTTPS URLを発行し、スマホはそのURLへアクセスする。

課題:

- インターネット接続が必要
- 外部サービス依存になる
- 当日のネットワーク不調に弱くなる可能性がある

### 案C: PWA/静的ページ + ファイルアップロード

ブラウザカメラが難しい場合、スマホの標準カメラで撮影し、WebAppのファイル選択からアップロードする。

長所:

- HTTPS制約の影響を受けにくい
- iPhone/Androidで安定しやすい

短所:

- 撮影操作が1ステップ増える

本番の保険として、WebAppには必ず「カメラ撮影」と「画像ファイル選択アップロード」の両方を用意する。

## 推奨UI

### スマホ側

初期画面:

- 名前または担当者ID入力
- 担当場所/テーブル選択
- カメラ起動ボタン

撮影画面:

- カメラプレビュー
- シャッターボタン
- 画像プレビュー
- 送信ボタン
- 撮り直しボタン
- アップロード状態
- 送信済み件数

補助入力:

- ニックネーム
- ジャンル
- 地図エリア
- メモ

ただし当日は入力項目を増やしすぎない。最低限は画像だけ送れればよい。

### X1管理画面

- 接続中メンバー一覧
- 受信画像一覧
- 未送信キュー
- 研究室PC/クラウドへの送信状態
- エラー一覧
- 再送ボタン
- 手動アップロードボタン

## データ保存

X1上では必ずローカル保存する。ネットワーク送信に失敗してもデータを失わないため。

```text
outputs\
  webapp-captures\
    reitaku-hcd-2026\
      captures\
        hcd-20260620-0001.jpg
      records\
        hcd-20260620-0001.json
      manifest.json
```

1件の `record.json` 例:

```json
{
  "id": "hcd-20260620-0001",
  "event_id": "reitaku-hcd-2026",
  "status": "captured",
  "operator": {
    "name": "member-a",
    "device_label": "iphone-01"
  },
  "capture": {
    "captured_at": "2026-06-20T13:30:00+09:00",
    "received_at": "2026-06-20T13:30:03+09:00",
    "local_image_path": "outputs/webapp-captures/reitaku-hcd-2026/captures/hcd-20260620-0001.jpg"
  },
  "memory": {
    "nickname": "",
    "genre": "unknown",
    "map_area": "",
    "note": ""
  },
  "sync": {
    "lab_pc_sent": false,
    "cloud_uploaded": false,
    "last_error": null
  }
}
```

## 研究室PCへの送信方式

### 推奨: クラウド/DB経由

X1が画像をクラウドストレージへアップロードし、研究室PCが未処理ジョブを取得する。

```text
X1 -> Supabase Storage + jobs table -> lab PC
```

長所:

- 建物間の直接通信に依存しない
- Chromeリモートデスクトップで研究室PCを監視できる
- 再実行しやすい

短所:

- クラウド接続が必要

### 代替: 研究室PCにHTTP受信サーバーを立てる

```text
X1 -> http://lab-pc:port/upload
```

長所:

- 構成が単純

短所:

- Eduroamや学内ネットワークで到達できない可能性が高い
- ファイアウォール設定が必要になる可能性がある

本番ではクラウド/DB経由を優先する。

## Next.js実装方針

Next.js App Routerで作る。

主な画面:

- `/`
  - スマホ撮影画面
- `/admin`
  - X1管理画面
- `/api/captures`
  - 画像アップロードAPI
- `/api/records`
  - ローカル記録一覧API
- `/api/sync`
  - クラウド/研究室PC送信用API

ローカル保存にはNode.jsの `fs` を使う。アップロードAPIは画像サイズ制限に注意する。

画像アップロード方式:

- `multipart/form-data`
- またはCanvasから `Blob` を作って `fetch()` で送信

初期は `multipart/form-data` が分かりやすい。

## 実装フェーズ

### フェーズ1: WebApp雛形

- `WebApp/` を作る
- Next.jsをセットアップする
- `/` と `/admin` を作る
- X1で起動してスマホからアクセスできるか確認する

完了条件:

- スマホからX1のWebAppを開ける

### フェーズ2: 画像アップロード

- スマホから画像ファイルをアップロードする
- X1の `outputs/webapp-captures/` に保存する
- `record.json` を作る

完了条件:

- iPhone/Androidから画像を送れて、X1に保存される

### フェーズ3: ブラウザカメラ撮影

- `getUserMedia()` でカメラプレビューを表示する
- シャッターでCanvasに切り出す
- 送信する
- 失敗時はファイルアップロードへ誘導する

完了条件:

- iPhone/Android両方で直接撮影して送信できる

### フェーズ4: 管理画面

- 受信画像一覧
- 送信状態
- エラー表示
- 再送ボタン

完了条件:

- X1担当者が当日の処理状況を追える

### フェーズ5: 研究室PC/OCR連携

- X1がクラウドへ画像とジョブをアップロードする
- 研究室PCがジョブを取りに行く
- OCR結果を更新する

完了条件:

- X1で撮った画像が研究室PCでOCRされる

### フェーズ6: レビュー/公開連携

- `pending_review` 生成
- 修正後 `approved`
- 表示アプリが `approved` のみ読む

完了条件:

- 誤認識を公開前に止められる

## 当日運用案

1. X1でWebAppを起動
2. メンバーがスマホでWebAppのURLを開く
3. 名前/担当場所を入力
4. 付箋を撮影
5. 送信成功をスマホ画面で確認
6. X1管理画面で受信状態を見る
7. 研究室PCがOCR処理
8. レビュー後、展示アプリに表示

## 事前検証チェックリスト

- [ ] X1とスマホが同じWi-Fiで通信できる
- [ ] iPhoneからWebAppを開ける
- [ ] AndroidからWebAppを開ける
- [ ] iPhoneでカメラ撮影が使える
- [ ] Androidでカメラ撮影が使える
- [ ] カメラが使えない場合にファイルアップロードできる
- [ ] 画像がX1にローカル保存される
- [ ] ネットが切れてもローカル保存が残る
- [ ] 研究室PCまたはクラウドへ再送できる
- [ ] `approved` 以外は展示アプリに出ない

## 判断ポイント

最初から完璧なリアルタイムOCRを狙わない。HCD本番で最優先なのは、来場者の付箋画像を失わないこと。

優先順位:

1. スマホからX1へ画像を確実に送る
2. X1にローカル保存する
3. 後から研究室PCでOCRできる
4. OCR結果をレビューして公開する
5. 可能ならリアルタイム表示する

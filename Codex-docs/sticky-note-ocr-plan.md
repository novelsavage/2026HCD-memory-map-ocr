# 手書き付箋OCRプログラム計画

作成日: 2026-06-07

## 目的

手書きの付箋を撮影または画像入力し、OCRで文字抽出する。あわせてOCR結果画像を保存し、オプションで付箋部分だけをトリミングした画像も保存する。

既存プロジェクトには YomiToku + OpenCV の構成があるため、最初は既存の `uv` / `opencv-python` / `yomitoku` を活かす。

HCD Home Coming Day では、物理的なアナログ地図に貼られた付箋を後続アプリケーションから読み込めるデータに変換する。単なるOCR結果ではなく、画像、抽出テキスト、イベント用メタデータをまとめた「投稿データ」として保存する。

## 基本方針

1. 入力画像を受け取る
2. 付箋領域を検出する
3. 必要なら傾き補正・台形補正を行う
4. OCRに渡す画像を保存する
5. YomiTokuで文字抽出する
6. OCR可視化画像と抽出テキストを保存する
7. オプション指定時だけ付箋トリミング画像を保存する

手書き文字はOCR難度が高いため、最初から完全自動にしすぎず、付箋検出の失敗時は元画像全体をOCRに渡すフォールバックを入れる。

## HCDアプリ連携の考え方

`思い出マップゼミ (2).md` の内容から、HCD当日は次の運用が想定される。

- 来場者が付箋にニックネームと思い出を書く
- 思い出ジャンルは色付きシールで表す
- 思い出地点はアナログMAP上のシール位置で表す
- 付箋と地点を紐でつなぐ
- デジタル側では Next.js / Supabase / Vercel 系のアプリケーションから読み込む

このためOCRプロジェクトは、次の2種類の成果物を出す。

1. 人が確認するためのローカル成果物
   - OCR入力画像
   - 付箋トリミング画像
   - OCR可視化画像
   - 抽出テキスト

2. 別アプリが読むための公開/共有成果物
   - 画像URL
   - OCRテキスト
   - 付箋ID
   - ジャンル
   - ニックネーム
   - 地図上の位置情報
   - 確認ステータス
   - 作成日時

OCR結果は誤認識が起きる前提で扱う。後続アプリに直接「確定投稿」として入れるのではなく、まず `pending_review` 状態で保存し、学生または運営が確認して `approved` にする流れが安全。

## 推奨アーキテクチャ

```text
physical sticky notes
  -> camera/scanner image
  -> OCR pipeline
  -> local review outputs
  -> upload images to network storage
  -> write JSON manifest or DB rows
  -> Next.js app reads approved records
```

第一候補:

- 画像保存: Supabase Storage
- データ保存: Supabase Postgres
- 表示アプリ: Next.js on Vercel

理由:

- ゼミメモに Supabase / Vercel / Next.js の方向性がある
- 画像とDBを同じSupabaseプロジェクトで管理できる
- 後続アプリから読み込みやすい
- `pending_review` / `approved` のような運用ステータスをDBで扱いやすい

代替候補:

- 画像保存: Cloudflare R2, AWS S3, Google Drive
- データ保存: Supabase, Google Sheets, JSONファイル, Firestore

Google DriveやGoogle Sheetsは準備が速いが、後続アプリの安定運用やURL管理を考えると、最終的にはSupabaseに寄せるほうが扱いやすい。

## データモデル案

後続アプリが読み込む1件の付箋データは次の形にする。

```json
{
  "id": "hcd-20260620-0001",
  "event_id": "reitaku-hcd-2026",
  "source": "sticky_note_ocr",
  "status": "pending_review",
  "nickname": "未確認",
  "memory_text_raw": "OCRで抽出した未修正テキスト",
  "memory_text": "",
  "genre": "unknown",
  "genre_color": "yellow",
  "map_location": {
    "label": "",
    "x": null,
    "y": null,
    "lat": null,
    "lng": null
  },
  "images": {
    "original_url": "",
    "crop_url": "",
    "ocr_input_url": "",
    "ocr_overlay_url": ""
  },
  "local_files": {
    "original": "outputs/sticky_notes/hcd-20260620-0001/original.png",
    "crop": "outputs/sticky_notes/hcd-20260620-0001/sticky_crop.png",
    "ocr_input": "outputs/sticky_notes/hcd-20260620-0001/ocr_input.png"
  },
  "ocr": {
    "engine": "yomitoku",
    "engine_mode": "lite_cpu",
    "confidence": null,
    "detected": true
  },
  "created_at": "2026-06-20T13:30:00+09:00",
  "reviewed_at": null
}
```

`memory_text_raw` はOCRそのまま、`memory_text` は人が修正した確定テキストにする。OCR誤認識を見える状態で残せるため、後から改善しやすい。

## Supabaseテーブル案

```sql
create table memories (
  id text primary key,
  event_id text not null,
  source text not null default 'sticky_note_ocr',
  status text not null default 'pending_review',
  nickname text,
  memory_text_raw text,
  memory_text text,
  genre text,
  genre_color text,
  map_label text,
  map_x double precision,
  map_y double precision,
  lat double precision,
  lng double precision,
  original_url text,
  crop_url text,
  ocr_input_url text,
  ocr_overlay_url text,
  ocr_engine text,
  ocr_engine_mode text,
  ocr_detected boolean,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
```

初期運用では `map_x` / `map_y` をアナログ地図画像上の相対座標として使うのが現実的。緯度経度が後から決まる場合は、レビュー画面で `lat` / `lng` を補完する。

## ネットストレージ連携方式

### 案A: OCR側がSupabaseへ直接アップロードする

Pythonスクリプトが以下を行う。

1. OCR処理
2. 画像をSupabase Storageへアップロード
3. `memories` テーブルに行を作成

長所:

- 後続アプリからすぐ読める
- 手動コピーが不要

短所:

- OCR側にSupabase URL/APIキーなどの環境変数が必要
- 当日ネットワーク不調時に詰まりやすい

### 案B: OCR側はJSONマニフェストだけ作り、別処理でアップロードする

Pythonスクリプトがローカルに `manifest.json` を作る。

```text
outputs/sticky_notes/hcd-2026-manifest.json
```

別のアップロードスクリプトが画像とJSONをSupabaseへ送る。

長所:

- OCRとアップロードを分離できる
- 当日ネットワーク不調でもOCR結果をローカル保存できる
- デバッグしやすい

短所:

- アップロード手順が1つ増える

初期実装は案Bを推奨する。HCD当日は安定性が重要なので、スキャン/OCR/保存を止めない構成にする。

## HCD当日の運用案

1. 付箋を貼ったアナログMAPを一定時間ごとに撮影する
2. 付箋単体も可能なら撮影する
3. OCRスクリプトで画像を処理する
4. `pending_review` のJSONを生成する
5. 学生が確認画面でOCRテキスト、ジャンル、地図位置を修正する
6. `approved` にしたデータだけ展示アプリに表示する

重要な運用判断:

- 付箋1枚ずつ撮影する場合
  - OCR精度と切り出し精度が高い
  - 手間が増える

- 地図全体を撮影する場合
  - 当日の記録として強い
  - 付箋検出、紐、シール、地図位置の自動解析は難しい

現実的には、地図全体は記録写真として保存し、OCR用には付箋単体または数枚ずつ近接撮影するのがよい。

## 追加CLI案

ネットストレージ連携を見越して、次のオプションを追加する。

```powershell
uv run python Codex-scripts/sticky_note_ocr.py data/input --event-id reitaku-hcd-2026 --manifest outputs/sticky_notes/hcd-2026-manifest.json
```

```powershell
uv run python Codex-scripts/upload_sticky_notes.py outputs/sticky_notes/hcd-2026-manifest.json --provider supabase
```

環境変数案:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=memory-images
```

サービスロールキーは公開アプリ側には絶対に置かない。アップロード用のローカルPCまたはサーバーだけで使う。

## 後続アプリ側の読み込み方

Next.js側は `status = 'approved'` のデータだけを読む。

必要な表示項目:

- ニックネーム
- 思い出本文
- ジャンル
- 地図上の位置
- 付箋画像
- 作成日時

確認画面では `pending_review` のデータも読む。

確認画面に必要な機能:

- OCR原文を見る
- 付箋画像を見る
- 思い出本文を修正する
- ジャンルを選ぶ
- 地図上の位置を指定する
- `approved` / `rejected` に変更する

この確認画面を作ると、OCRの不確実性を人間が吸収できる。

## 想定ディレクトリ

```text
C:\Projects\OCR\
  Codex-scripts\
    sticky_note_ocr.py
    upload_sticky_notes.py
  data\
    input\
  outputs\
    sticky_notes\
      <input_stem>\
        original.png
        ocr_input.png
        sticky_crop.png        # --save-crop 指定時
        result.md
        record.json
        yomitoku\
          *_ocr.jpg
          *_layout.jpg
          *.md
      hcd-2026-manifest.json
```

## CLI案

```powershell
uv run python Codex-scripts/sticky_note_ocr.py data/input/sample.png
```

オプション:

```powershell
uv run python Codex-scripts/sticky_note_ocr.py data/input/sample.png --save-crop
uv run python Codex-scripts/sticky_note_ocr.py data/input --save-crop
uv run python Codex-scripts/sticky_note_ocr.py data/input/sample.png --no-detect
uv run python Codex-scripts/sticky_note_ocr.py data/input/sample.png --format md
uv run python Codex-scripts/sticky_note_ocr.py data/input/sample.png --min-area-ratio 0.03
```

主な引数:

- `input`: 画像ファイルまたは画像ディレクトリ
- `--outdir`: 出力先。既定は `outputs/sticky_notes`
- `--save-crop`: 付箋だけのトリミング画像を保存する
- `--no-detect`: 付箋検出をせず画像全体をOCRする
- `--format`: YomiToku出力形式。既定は `md`
- `--min-area-ratio`: 付箋候補として扱う最小面積比
- `--debug`: 検出輪郭などのデバッグ画像を保存する

## 付箋検出ロジック案

OpenCVで次の順に処理する。

1. 画像を読み込む
2. リサイズして処理速度と閾値を安定させる
3. HSV色空間に変換する
4. 黄色、ピンク、水色などの付箋色をマスクする
5. モルフォロジー処理で穴埋めする
6. 輪郭を取得する
7. 面積、四角形らしさ、縦横比で候補を絞る
8. 最大または最も中央に近い候補を付箋とみなす
9. `minAreaRect` または四点近似でトリミングする

検出に失敗した場合:

- `ocr_input.png` には元画像を保存する
- ログに `sticky note not detected; using original image` を出す
- OCR処理は止めない

## 画像補正案

最初の実装では軽量な補正にする。

- 台形補正: 四点検出できた場合だけ実行
- 傾き補正: `minAreaRect` の角度を使う
- 余白追加: 文字が端で切れないように数十pxの白余白を追加
- 解像度補正: 小さい付箋は2倍程度に拡大
- 色補正: OCR入力はカラーまたはグレースケールの両方を試せる余地を残す

手書き付箋では、強い二値化は文字のかすれを消すことがあるため、初期実装では過度な二値化を避ける。

## OCR処理案

既存環境に合わせて YomiToku をサブプロセスで実行する。

```powershell
yomitoku <ocr_input.png> --lite -d cpu -f md -o <output_dir> -v
```

Python側では以下を行う。

- `shutil.which("yomitoku")` でコマンド存在確認
- `subprocess.run()` で実行
- 戻り値が非0ならエラーを表示
- YomiTokuが生成した `*.md` を読み、`result.md` または `result.txt` にコピー/集約する

## 保存する画像

常に保存:

- `original.png`: 入力画像のコピー
- `ocr_input.png`: OCRに実際に渡した画像
- YomiToku生成の `*_ocr.jpg`: OCR可視化画像
- YomiToku生成の `*_layout.jpg`: レイアウト可視化画像

オプション保存:

- `sticky_crop.png`: 付箋だけを切り出した画像
- `debug_mask.png`: 色マスク
- `debug_contours.png`: 検出輪郭

## 実装フェーズ

### フェーズ1: 画像ファイル1枚の最小版

- 1枚の画像を受け取る
- 付箋検出なしで画像全体をYomiTokuに渡す
- OCR結果と可視化画像を保存する

完了条件:

- `uv run python Codex-scripts/sticky_note_ocr.py data/input/sample.png` で結果が出る

### フェーズ2: 付箋トリミング

- HSV色マスクで付箋候補を検出する
- `--save-crop` 指定時に `sticky_crop.png` を保存する
- OCR入力をトリミング画像に切り替える
- 検出失敗時は元画像へフォールバックする

完了条件:

- 付箋が写った画像で `ocr_input.png` が付箋中心になる

### フェーズ3: 複数画像処理

- 入力がディレクトリの場合、画像を順に処理する
- 各画像ごとに独立した出力ディレクトリを作る
- 成功/失敗のサマリーを表示する

完了条件:

- `data/input/` 配下の複数画像を一括処理できる

### フェーズ4: デバッグと評価

- `--debug` でマスク・輪郭画像を保存する
- 認識結果のMarkdownを一覧化する
- 必要なら `data/ground_truth/` と比較するCER評価を追加する

### フェーズ5: HCD連携用JSON生成

- 1付箋ごとに `record.json` を生成する
- 全件を `manifest.json` にまとめる
- `event_id`、`status`、画像パス、OCR原文を含める
- 後続アプリがそのまま読める形にする

完了条件:

- `outputs/sticky_notes/hcd-2026-manifest.json` をNext.js側で読み込める

### フェーズ6: ネットストレージアップロード

- Supabase Storageへ画像をアップロードする
- アップロード後のURLをJSONに反映する
- 必要ならSupabase DBへ行を作成する

完了条件:

- Next.jsアプリから `approved` データと画像URLを読める

## スマホカメラ連携の再設計

参考実装:

```text
C:\Users\Mori\Documents\nothing-camera-test
```

確認した内容:

- `main.py` は OpenCV の `VideoCapture` でスマホカメラのHTTPストリームを読む
- 設定は `config.toml`
- URLは `camera.base_url` と `camera.video_path` から組み立てる
- 既定例は `http://10.30.56.253:8080/video`
- 依存は `opencv-python` のみ
- フレーム取得は別スレッドで行い、常に最新フレームだけを保持する

この方式はOCR側に流用できる。既存のWebカメラGUIを、ローカルカメラ番号ではなく複数のスマホHTTPストリームを読む設計に変更する。

### 複数スマホ対応の構成

```text
smartphone A -> http://<phone-a>:8080/video -> capture thread A
smartphone B -> http://<phone-b>:8080/video -> capture thread B
smartphone C -> http://<phone-c>:8080/video -> capture thread C
                                      -> capture dashboard
                                      -> saved images
                                      -> OCR job queue
```

各スマホについて1つの `LatestFrameCapture` を起動する。GUIは全スマホのプレビューをグリッド表示し、次の操作をできるようにする。

- 各スマホごとのシャッター
- 全スマホ同時シャッター
- カメラ接続状態の表示
- 最後に保存した画像名の表示
- OCRキュー件数の表示

初期実装では、OCRはキューに積んで順番に処理する。複数スマホで撮影は並列、OCRはPC性能に応じて並列数を調整する。

### 設定ファイル案

```toml
[event]
event_id = "reitaku-hcd-2026"

[storage]
local_outdir = "outputs/sticky_notes"
manifest = "outputs/sticky_notes/hcd-2026-manifest.json"

[ocr]
engine = "yomitoku"
device = "cpu"
lite = true
worker_count = 1

[[cameras]]
id = "phone-01"
label = "受付側"
base_url = "http://10.30.56.253:8080"
video_path = "/video"

[[cameras]]
id = "phone-02"
label = "地図側"
base_url = "http://10.30.56.254:8080"
video_path = "/video"

[[cameras]]
id = "phone-03"
label = "確認用"
base_url = "http://10.30.56.255:8080"
video_path = "/video"
```

想定ファイル:

```text
Codex-scripts\
  multi_phone_sticky_ocr.py
  sticky_note_ocr.py
  upload_sticky_notes.py
```

`multi_phone_sticky_ocr.py` は撮影・保存・OCRキュー投入を担当し、付箋検出やOCR本体は `sticky_note_ocr.py` の関数を呼ぶ形にする。

### 出力データへのカメラ情報追加

各 `record.json` に撮影元を残す。

```json
{
  "id": "hcd-20260620-0001",
  "event_id": "reitaku-hcd-2026",
  "camera": {
    "id": "phone-01",
    "label": "受付側"
  },
  "capture": {
    "captured_at": "2026-06-20T13:30:00+09:00",
    "source_url": "http://10.30.56.253:8080/video"
  }
}
```

どのスマホで撮ったかが残ると、当日トラブル時に原因を追いやすい。

## 研究室PCを使う場合の構成

イベント現地と研究室が同じ大学内でも、直接ストリームを飛ばす前提にはしないほうがよい。

理由:

- Eduroamは同じSSIDでも、建物やアクセスポイントごとに通信経路が違う可能性がある
- 端末同士の直接通信が制限されることがある
- スマホのIPアドレスが変わりやすい
- HTTPストリームは切れやすく、建物をまたいだ常時接続には向かない
- Chromeリモートデスクトップは研究室PCを操作できるが、スマホカメラのHTTPストリームを安定中継する仕組みではない

そのため、研究室PCは「スマホカメラを直接読むPC」ではなく「OCRワーカー」として使うのが安全。

### 推奨構成

```text
HCD現地
  smartphones
    -> event laptop / capture PC
      -> local save
      -> upload original/crop images + pending jobs

network storage / queue
  Supabase Storage + Supabase DB
  or shared cloud folder + JSON manifest

研究室PC
  -> pull pending OCR jobs
  -> run OCR with better compute
  -> upload OCR result / update DB

Next.js app
  -> read approved records
```

この構成なら、現地と研究室が直接同じLAN上で見えていなくても動く。現地PCは画像保存とアップロードに集中し、研究室PCはOCR処理に集中する。

### 処理分担案

現地PC:

- 複数スマホから映像を取得する
- シャッター操作で画像を保存する
- 付箋トリミングを軽く試す
- `record.json` を `pending_ocr` として作る
- ネットストレージへ画像をアップロードする

研究室PC:

- `pending_ocr` のデータを取得する
- YomiTokuなどでOCRを実行する
- OCRテキストと可視化画像をアップロードする
- ステータスを `pending_review` に更新する

レビュー担当:

- OCR結果を確認する
- 本文、ジャンル、地図位置を修正する
- ステータスを `approved` にする

表示アプリ:

- `approved` のデータだけ表示する

### ステータス遷移案

```text
captured
  -> pending_upload
  -> pending_ocr
  -> ocr_running
  -> pending_review
  -> approved
  -> displayed
```

失敗時:

```text
ocr_failed
upload_failed
rejected
```

ステータスを明示すると、複数人・複数PCで作業しても「どこまで終わったか」が見える。

## ネットワーク方針

### 当日最も安定しやすい案

HCD現地では、スマホと現地PCを同じローカルネットワークに置く。

候補:

1. EduroamでスマホとPCを接続する
2. うまくいかない場合、専用Wi-Fiルーターまたはスマホテザリングを使う
3. 最悪の場合、スマホで撮った写真をローカル/クラウドフォルダへ送ってOCRする

Eduroamで事前に確認すること:

- PCからスマホの `http://<phone-ip>:8080/video` にアクセスできるか
- 複数スマホに同時接続しても切れないか
- IPアドレスが途中で変わらないか
- アクセスポイントをまたいだ時に接続が切れないか

現地と研究室間で確認すること:

- 現地PCからSupabaseなどのネットストレージへアップロードできるか
- 研究室PCから同じストレージを読めるか
- Chromeリモートデスクトップで研究室PCのOCRワーカーを起動・監視できるか

### Android / iPhone混在運用

Androidの `IP Webcam` と同じ考え方で、iPhoneも「iPhone自身がHTTP/RTSP/MJPEGサーバーになるアプリ」を使えば対応できる。

重要なのは、iPhoneアプリが単なるIPカメラ閲覧アプリではなく、iPhoneのカメラ映像を外部から読めるURLとして公開できること。

候補の条件:

- iPhoneをIP Camera Serverとして動かせる
- HTTPまたはMJPEG URLをブラウザで開ける
- 可能ならRTSPにも対応している
- 認証をオフにできる、またはユーザー名/パスワードをURLや設定で扱える
- 画質、解像度、FPSを下げられる

アプリ候補:

- `IP Camera Lite`
  - iOS端末をHTTP/RTSPサーバー化できる
  - ブラウザ表示に対応
  - MJPEG/RTSP系の連携がしやすい
- `ipCam`
  - ブラウザ互換の映像配信に対応
  - MJPEGフレームレート調整ができる

避けるもの:

- IPカメラを見るだけのビューアアプリ
- 独自クラウド経由でしか見られないアプリ
- PC側に専用ドライバが必要で、HTTP URLを出せないアプリ

OCRプログラム側は、AndroidかiPhoneかを区別しない。設定ファイルに `base_url` と `video_path` を書ければ同じ `LatestFrameCapture` で読む。

### IPアドレスが勝手に変わる問題

Android側のIPアドレスが変わる主な原因:

- DHCPで自動割り当てされている
- Eduroam内で接続先アクセスポイントが変わる
- スマホのWi-Fiが省電力で切断/再接続される
- AndroidのランダムMACアドレス設定により、ネットワーク側から別端末扱いになる
- 端末がモバイル通信や別Wi-Fiへ切り替わる

本番での推奨順:

1. 専用Wi-Fiルーターを現地に置き、スマホと現地PCだけを接続する
2. ルーター側でDHCP予約を設定し、スマホごとに固定IPを割り当てる
3. スマホ側のランダムMAC/プライベートWi-Fiアドレスをオフにする、または表示されたMACに対して予約する
4. スマホ側の画面スリープ、バッテリー最適化、Wi-Fi自動切替を切る
5. OCRアプリ側は接続失敗時に自動再接続し、GUIからURLを差し替えられるようにする

Eduroamだけで運用する場合:

- IP固定やDHCP予約は基本的にこちらで管理できない
- 端末間通信が制限される可能性がある
- アクセスポイント移動でIPが変わる可能性がある

そのため、HCD本番ではEduroamをスマホカメラ用LANとして期待しすぎない。Eduroamはネットストレージへのアップロード用、スマホカメラ接続は専用ローカルWi-Fi、という分離が最も安定しやすい。

### カメラURL変更への実装対応

本番ではIP変更をゼロにできない前提で、ソフト側にも逃げ道を作る。

- GUIにカメラごとの `base_url` 再入力欄を作る
- 設定ファイルを再読み込みできるキーを用意する
- 接続失敗中でも他のカメラは動かし続ける
- 最後に接続できたURL、失敗回数、最終フレーム時刻を表示する
- 各スマホ画面に表示されているURLを見て、その場で差し替えられるようにする

発展案として、スマホごとのQRコードを読んでURL登録する運用も考えられる。ただし初期実装では、手入力と設定再読み込みで十分。

### 直接ストリーム転送を避ける理由

研究室PCが現地スマホの `/video` を直接読む案は、実験としてはあり。ただし本番では優先しない。

問題になりやすい点:

- IP到達性が不安定
- HTTP MJPEG/動画ストリームが切れやすい
- 複数スマホ分の帯域を建物間で消費する
- カメラが切れたときに復旧が面倒

本番では「画像ファイル単位でアップロードし、OCRワーカーが処理する」ほうが復旧しやすい。

## 実装フェーズの再整理

### フェーズ1: 単一スマホOCR

- `nothing-camera-test` の `LatestFrameCapture` を参考にする
- スマホ `/video` を読み込む
- Space/Enterで画像保存
- 保存画像を既存のYomiToku OCRに渡す

完了条件:

- 1台のスマホ映像から付箋画像を撮影し、OCR結果が保存される

### フェーズ2: 複数スマホ撮影ダッシュボード

- `[[cameras]]` 設定に対応する
- 複数プレビューをグリッド表示する
- カメラ別シャッターと全体シャッターを用意する
- カメラごとの接続状態を表示する

完了条件:

- 2台以上のスマホから同時に撮影できる

### フェーズ3: OCRキュー化

- 撮影とOCRを分離する
- 撮影は止めずにOCRジョブをキューへ積む
- `worker_count` でOCR並列数を調整する

完了条件:

- OCR中でも次の撮影ができる

### フェーズ4: HCD manifest生成

- 各撮影に `record.json` を作る
- `manifest.json` に集約する
- `camera.id`、`camera.label`、`event_id` を含める

完了条件:

- 後続アプリまたはアップロードスクリプトが読み込める

### フェーズ5: 研究室PC OCRワーカー

- 現地PCは画像とジョブをアップロードする
- 研究室PCは未処理ジョブを取得する
- OCR結果をアップロードしてステータスを更新する

完了条件:

- 現地PCで撮った画像を研究室PCがOCR処理できる

### フェーズ6: レビュー・公開

- `pending_review` のデータを確認する画面を作る
- 人が修正したデータだけ `approved` にする
- 展示アプリは `approved` だけ表示する

完了条件:

- OCR誤認識があっても、公開前に修正できる

## 当日までの事前検証チェックリスト

- [ ] スマホ1台で `/video` をPCから読める
- [ ] スマホ2台以上で同時にプレビューできる
- [ ] 各スマホからシャッター保存できる
- [ ] OCR中でも撮影が止まらない
- [ ] 現地想定場所のEduroamでスマホIPへ到達できる
- [ ] 研究室PCからネットストレージを読める
- [ ] Chromeリモートデスクトップで研究室PCのOCR処理を監視できる
- [ ] ネットが切れてもローカル保存が残る
- [ ] アップロード失敗分を後から再実行できる
- [ ] `approved` 以外は表示アプリに出ない

## リスクと対策

- 手書き文字の認識精度が低い
  - 対策: OCR入力画像の拡大、余白追加、照明改善、別エンジン比較を後続で検討する

- 付箋色が背景と近く検出できない
  - 対策: `--no-detect` と検出失敗フォールバックを用意する

- 複数付箋が写っている
  - 初期実装: 最大候補だけ処理する
  - 後続実装: `--multi` で全候補を処理する

- 斜め撮影で文字が歪む
  - 対策: 四点検出できる場合に射影変換を行う

- OCR結果をそのまま公開してしまう
  - 対策: すべて `pending_review` で保存し、人が確認したものだけ `approved` にする

- 当日ネットワークが不安定
  - 対策: OCRとローカルJSON生成を先に完結させ、アップロードは後から再実行できるようにする

- 個人情報や不適切投稿が含まれる
  - 対策: 公開前レビュー、`rejected` ステータス、必要ならニックネーム非表示を用意する

- 複数スマホのHTTPストリームが不安定
  - 対策: 各スマホを独立スレッドで再接続し、撮影時は最新フレームだけ保存する

- Eduroamで端末間通信ができない
  - 対策: 専用Wi-Fiルーター、スマホテザリング、または写真アップロード方式へ切り替える

- 研究室PCと現地スマホが直接通信できない
  - 対策: 直接通信を前提にせず、ネットストレージ経由のジョブ処理にする

## 次に実装するなら

最初に `Codex-scripts/sticky_note_ocr.py` を作り、以下の順で小さく実装する。

1. CLIと出力ディレクトリ作成
2. 画像コピーと `ocr_input.png` 保存
3. YomiToku実行
4. `--save-crop` と付箋検出
5. ディレクトリ一括処理
6. `--debug` 出力
7. `record.json` / `manifest.json` 生成
8. Supabaseアップロードスクリプト

スマホ連携を先に進める場合は、`Codex-scripts/multi_phone_sticky_ocr.py` を作る。

1. `nothing-camera-test` の `LatestFrameCapture` を流用する
2. 複数カメラ設定を読む
3. グリッドプレビューを表示する
4. シャッターで画像保存する
5. 保存画像をOCRキューへ渡す
6. `record.json` と `manifest.json` を生成する

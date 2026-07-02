# 日本語OCR検証計画

作成日: 2026-05-27

## 現状

- 作業ディレクトリ: `C:\Projects\OCR`
- 既存プロジェクトファイル: なし
- Git: 未初期化
- `uv`: 利用可能 (`uv 0.10.4`)
- `python`: `python.exe` コマンドはあるが、実体は Microsoft Store の実行エイリアスで、通常の Python 実行環境は未確認
- 生成物の配置ルール:
  - 調査・計画: `Codex-docs/`
  - 一時スクリプト: `Codex-scripts/`

## 目的

日本語画像に対して複数OCRエンジンを試し、次の観点で実用性を判断する。

- 横書き日本語の認識精度
- 縦書き日本語の認識精度
- 英数字・記号・日本語混在テキストの認識精度
- 低解像度、傾き、ノイズ、影、紙面ゆがみへの強さ
- Windows + `uv` 環境での導入しやすさ
- GPU なしでも現実的に動くか

## 推奨方針

最初は CPU で動かせる構成に絞る。X1 Carbon では CUDA が使えないため、GPU 前提の構成は採用しない。

候補は次の順で試す。

1. `YomiToku` 軽量モデル
   - 長所: 日本語文書向け。OCR、レイアウト解析、表構造認識、読み順推定、Markdown/HTML/JSON/PDF出力に対応
   - 短所: PyTorch 依存。初回に Hugging Face Hub からモデル取得が必要
   - 注意: CUDA なしでは `--lite -d cpu` を基本にする。軽量モデルは1行あたり最大50文字の制限あり

2. `tesseract-ocr` + `pytesseract`
   - 長所: 軽量、ローカル実行、導入情報が多い
   - 短所: 日本語の精度は画像品質と前処理に大きく依存
   - 注意: Windows では Tesseract 本体と日本語言語データが別途必要

3. `PaddleOCR`
   - 長所: 日本語を含む多言語OCRで実用例が多い
   - 短所: 依存が重め。環境によってはインストール調整が必要
   - 注意: torch ではないが、機械学習系依存が入る

4. `EasyOCR`
   - 長所: 導入後は簡単に使える
   - 短所: torch 依存。GPU/CUDA 確認なしに入れない
   - 注意: 初回検証では後回し

YomiToku の詳細調査は `Codex-docs/yomitoku-research.md` に記録する。

## フェーズ1: 最小環境を作る

実施内容:

1. `uv python install` でプロジェクト用 Python を用意する
2. `uv init` で最小プロジェクトを作る
3. CPU 版 PyTorch と YomiToku を導入する
4. `samples/` または `data/input/` を作り、OCR対象画像を配置する
5. YomiToku 軽量モデルで1枚だけ読み取る

成果物:

- `pyproject.toml`
- `.python-version`
- `Codex-docs/yomitoku-smoke-result.md`

判断基準:

- 1枚の画像から日本語テキストが抽出できる
- 文字化けせず UTF-8 の結果を保存できる
- 実行手順が `uv run ...` で再現できる

想定コマンド:

```powershell
uv python install 3.12
uv init
uv python pin 3.12
uv add torch torchvision --index-url https://download.pytorch.org/whl/cpu
uv add yomitoku
uv run yomitoku data/input --lite -d cpu -f md -o outputs/yomitoku -v
```

## フェーズ2: Tesseract の日本語検証

前提:

- Tesseract 本体のインストール状態を確認する
- `jpn` と、縦書き用に必要なら `jpn_vert` の言語データを確認する

検証ケース:

- 印刷された横書き日本語
- 印刷された縦書き日本語
- スクリーンショット
- レシート・帳票風の画像
- スマホ撮影の傾いた紙面

実装:

- 画像前処理を切り替えられるスクリプトを作る
  - グレースケール
  - 二値化
  - 拡大
  - 傾き補正
  - ノイズ除去
- OCR設定を切り替える
  - `--psm 6`: 単一ブロック
  - `--psm 11`: 疎なテキスト
  - `-l jpn`
  - `-l jpn_vert`

成果物:

- `Codex-scripts/run_tesseract_cases.py`
- `Codex-docs/tesseract-comparison.md`
- `outputs/` 配下のOCR結果テキスト

## フェーズ3: PaddleOCR 比較

実施条件:

- Tesseract の結果が不十分、または精度比較が必要になった時点で実施
- インストール前に公式ドキュメントで現在の対応PythonバージョンとWindows対応状況を確認する

実施内容:

1. 別ブランチ相当の依存追加として扱う
2. CPU 版で導入する
3. Tesseract と同じ入力画像で比較する
4. 実行時間、認識結果、導入手順の重さを記録する

成果物:

- `Codex-scripts/run_paddleocr_cases.py`
- `Codex-docs/paddleocr-comparison.md`

## フェーズ4: 評価方法

手動評価から始める。

- 正解テキストを `data/ground_truth/` に保存
- OCR結果を `outputs/{engine}/` に保存
- 文字単位の差分を比較
- 必要なら CER (Character Error Rate) を計算する

最初から厳密な評価基盤を作り込まない。まずは数枚で、どのエンジンが使えそうかを見極める。

## 推奨ディレクトリ構成

```text
C:\Projects\OCR\
  Codex-docs\
    japanese-ocr-plan.md
    tesseract-smoke-result.md
    tesseract-comparison.md
    paddleocr-comparison.md
  Codex-scripts\
    ocr_tesseract_smoke.py
    run_tesseract_cases.py
    run_paddleocr_cases.py
  data\
    input\
    ground_truth\
  outputs\
    tesseract\
    paddleocr\
  pyproject.toml
  .python-version
```

## 最初に実行する候補コマンド

Python 実体が未整備のため、まず `uv` で用意する。

```powershell
uv python install 3.12
uv init
uv python pin 3.12
uv add pillow opencv-python pytesseract pandas
```

Tesseract 本体は Python パッケージではないため別確認が必要。

```powershell
tesseract --version
tesseract --list-langs
```

未インストールなら、Windows 用 Tesseract と日本語 traineddata の導入を行う。

## 次の一手

1. サンプル画像を `data/input/` に置く
2. Tesseract 本体の有無を確認する
3. `uv` で Python 3.12 のプロジェクトを作る
4. Tesseract のスモークテストを1枚で実行する
5. 結果が弱い場合だけ PaddleOCR の比較へ進む

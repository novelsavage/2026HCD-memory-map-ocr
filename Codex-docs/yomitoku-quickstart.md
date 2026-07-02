# YomiToku CPU 実行手順

作成日: 2026-05-27

## 現在の状態

このディレクトリは `uv` プロジェクトとして初期化済み。

- Python: `3.12`
- YomiToku: `0.13.0`
- PyTorch: `2.12.0+cpu`
- CUDA: `False`
- 入力先: `data/input/`
- 出力先: `outputs/yomitoku/`
- 実行スクリプト: `Codex-scripts/run_yomitoku_cpu.py`

## 入力ファイルを置く

OCRしたい画像またはPDFを `data/input/` に置く。

対応候補:

- `.pdf`
- `.png`
- `.jpg`
- `.jpeg`
- `.bmp`
- `.tiff`
- `.tif`

YomiToku 公式ドキュメントでは、精度のために短辺 1000px 以上の画像が推奨されている。

## 基本実行

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py
```

このコマンドは内部で次の条件を固定する。

- `--lite`
- `-d cpu`
- `-f md`
- `-o outputs/yomitoku`
- `-v`

つまり、CUDA を使わず CPU 軽量モデルで Markdown と可視化画像を出力する。

## ファイルを直接指定する

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py data/input/sample.pdf
```

## PDFを1つのMarkdownにまとめる

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py data/input/sample.pdf --combine
```

## 図表も出力する

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py --figure
```

図表内の文字も出力したい場合:

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py --figure --figure-letter
```

## 出力形式を変える

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py -f json
uv run python Codex-scripts/run_yomitoku_cpu.py -f html
uv run python Codex-scripts/run_yomitoku_cpu.py -f pdf
```

## 読み順を指定する

通常は `auto` のままでよい。縦書きや帳票で読み順が崩れる場合だけ指定する。

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py --reading-order right2left
uv run python Codex-scripts/run_yomitoku_cpu.py --reading-order left2right
uv run python Codex-scripts/run_yomitoku_cpu.py --reading-order top2bottom
```

## 検証済みコマンド

```powershell
uv run yomitoku --help
uv run python Codex-scripts/run_yomitoku_cpu.py --help
uv run python -c "import torch, yomitoku; print(torch.__version__, torch.cuda.is_available(), yomitoku.__version__)"
```

確認結果:

```text
torch 2.12.0+cpu
cuda False
yomitoku 0.13.0
```

## 注意

初回の OCR 実行時に Hugging Face Hub からモデルが自動ダウンロードされる。ネットワーク接続が必要。

`data/input/` に入力ファイルがない状態で実行すると、スクリプトは対象ファイルなしとして停止する。


# YomiToku セットアップ結果

作成日: 2026-05-27

## 実施内容

- `uv python install 3.12`
- `uv init --name japanese-ocr --bare`
- `uv python pin 3.12`
- `uv add torch torchvision --index-url https://download.pytorch.org/whl/cpu`
- `uv add yomitoku`
- `data/input/`, `data/ground_truth/`, `outputs/yomitoku/` を作成
- `Codex-scripts/run_yomitoku_cpu.py` を追加
- `.gitignore` を追加

## 確認結果

```text
torch 2.12.0+cpu
cuda False
yomitoku 0.13.0
```

`uv run yomitoku --help` は成功。

`uv run python Codex-scripts/run_yomitoku_cpu.py --help` は成功。

`uv run python -m py_compile Codex-scripts/run_yomitoku_cpu.py` は成功。

## 未実施

実入力ファイルがまだないため、OCR本体の実行は未実施。

`data/input/` に `.pdf`, `.png`, `.jpg` などを置いてから次を実行する。

```powershell
uv run python Codex-scripts/run_yomitoku_cpu.py
```

初回 OCR 実行時は Hugging Face Hub からモデルをダウンロードするため、ネットワーク接続が必要。


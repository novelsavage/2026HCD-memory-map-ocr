# Webカメラ YomiToku GUI

作成日: 2026-05-27

## 概要

OpenCV で Web カメラのプレビューウィンドウを表示し、シャッター操作でそのフレームを保存して YomiToku OCR を実行する。

実装ファイル:

```text
Codex-scripts/camera_yomitoku_gui.py
```

## 実行

```powershell
uv run python Codex-scripts/camera_yomitoku_gui.py
```

## 操作

- `Space`: シャッターを切って OCR 実行
- `Enter`: シャッターを切って OCR 実行
- `Q`: 終了
- `Esc`: 終了

OCR はバックグラウンドで1件ずつ実行する。推論中に追加でシャッターを押した場合は、現在の推論が終わるまで新しい推論は開始しない。

## 出力

撮影画像:

```text
outputs/camera/captures/
```

YomiToku の出力:

```text
outputs/camera/yomitoku/
```

各シャッターごとに、撮影ファイル名に対応したサブディレクトリへ出力する。

## YomiToku 実行条件

内部では次の条件で YomiToku を呼び出す。

```powershell
yomitoku <captured_png> --lite -d cpu -f md -o <output_dir> -v
```

CUDA は使わない。

## オプション例

カメラ番号を変える:

```powershell
uv run python Codex-scripts/camera_yomitoku_gui.py --camera 1
```

解像度を変える:

```powershell
uv run python Codex-scripts/camera_yomitoku_gui.py --width 1920 --height 1080
```

JSON 出力にする:

```powershell
uv run python Codex-scripts/camera_yomitoku_gui.py -f json
```

図表抽出も有効にする:

```powershell
uv run python Codex-scripts/camera_yomitoku_gui.py --figure
```

改行を段落内で連結する:

```powershell
uv run python Codex-scripts/camera_yomitoku_gui.py --ignore-line-break
```

## 注意

初回 OCR 時は YomiToku が Hugging Face Hub からモデルをダウンロードするため、ネットワーク接続が必要。

Web カメラが `--camera 0` で開けない場合は `--camera 1` などを試す。

OpenCV のプレビューウィンドウを使うため、デスクトップセッション上で実行する。


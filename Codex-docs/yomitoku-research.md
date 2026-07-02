# YomiToku 調査メモ

作成日: 2026-05-27

## 結論

X1 Carbon で CUDA が使えない前提なら、YomiToku は `--lite -d cpu` で試す価値がある。

ただし、Tesseract より依存関係とモデル取得が重い。最初の実験では「1から3枚の文書画像で CPU 軽量モデルだけを試す」範囲に絞るのが妥当。

## 何ができるか

YomiToku は日本語向けの Document AI / OCR パッケージ。

- 全文 OCR
- レイアウト解析
- 表構造認識
- 読み順推定
- 図表・画像の抽出
- Markdown / HTML / JSON / CSV / searchable PDF 出力
- 縦書き、日本語レイアウトへの対応

文書 OCR 向けであり、看板や街中の文字などの情景 OCR には最適化されていない。

## CPU 環境での重要点

- 通常モデルは GPU 推奨。
- 通常モデルも CPU で動くが、時間がかかる。
- 軽量モデルは CPU 推論向け。
- 軽量モデルは通常モデルより高速だが、精度低下の可能性がある。
- 軽量モデルには「1行あたり最大50文字」の制限がある。
- 入力画像は短辺 1000px 以上が推奨されている。

X1 Carbon では、最初から通常モデルを CPU で回すより、軽量モデルだけで評価する。

## インストール前提

PyPI の最新確認時点:

- パッケージ: `yomitoku`
- バージョン: `0.13.0`
- リリース日: 2026-05-14
- Python 要件: `>=3.10,<3.14`
- ライセンス: `CC BY-NC-SA 4.0`
- 追加機能: `extract`, `mcp`

実行には Python 3.10+ と PyTorch が必要。

現在このディレクトリでは `uv` は利用可能だが、通常の `python` 実体は未整備。したがって、まず `uv python install 3.12` でローカル Python を用意する。

## 推奨する試行コマンド案

CUDA なし前提なので、CPU 版 PyTorch を明示してから YomiToku を入れる方針にする。

```powershell
uv python install 3.12
uv init
uv python pin 3.12
uv add torch torchvision --index-url https://download.pytorch.org/whl/cpu
uv add yomitoku
```

実行は軽量モデル + CPU 指定に固定する。

```powershell
uv run yomitoku data/input --lite -d cpu -f md -o outputs/yomitoku -v
```

PDFをまとめて Markdown にする場合:

```powershell
uv run yomitoku data/input/sample.pdf --lite -d cpu -f md --combine -o outputs/yomitoku -v
```

図やグラフの切り出しも見る場合:

```powershell
uv run yomitoku data/input --lite -d cpu -f md -o outputs/yomitoku -v --figure
```

## 初回実行時の注意

YomiToku は初回実行時に Hugging Face Hub からモデル重みを自動ダウンロードする。

このため、初回だけネットワーク接続が必要。オフライン利用する場合は `download_model` で事前取得し、取得された `KotaroKinoshita` ディレクトリを実行時のカレントディレクトリに置く運用が案内されている。

## 評価観点

まず次の画像だけで試す。

1. 横書き日本語の印刷文書
2. 縦書き日本語を含む文書
3. 表を含むPDFまたは画像

確認項目:

- Markdown 出力の読み順が自然か
- 段組み文書の順序が崩れないか
- 表がどの程度構造として残るか
- 縦書きの本文が読めるか
- X1 Carbon の CPU で処理時間が許容できるか
- メモリ不足や極端なスワップが起きないか

## ライセンス上の注意

OSS 版は CC BY-NC-SA 4.0。非商用の個人利用・研究・評価は可能とされている。

一方、業務効率化、商用PoC、受託開発、外部提供、SaaS、成果物の商用配布などは商用利用に該当しうる。仕事で使う場合は、商用ライセンスの確認が必要。

## OCR計画への反映

当初の計画では Tesseract を第一候補にしていたが、文書レイアウト解析まで含めるなら YomiToku を先に試す価値がある。

改訂後の優先順:

1. YomiToku `--lite -d cpu`
2. Tesseract + pytesseract
3. PaddleOCR CPU
4. EasyOCR は torch/CUDA 周りが重いため後回し

Tesseract は軽量で比較対象として残す。YomiToku はモデル型 OCR なので、帳票・PDF・段組み・表のある文書で特に比較価値がある。

## 参照元

- PyPI: https://pypi.org/project/yomitoku/
- 公式ドキュメント: https://kotaro-kinoshita.github.io/yomitoku/
- インストール: https://kotaro-kinoshita.github.io/yomitoku/installation/
- CLI: https://kotaro-kinoshita.github.io/yomitoku/cli/
- 商用利用ガイドライン: https://kotaro-kinoshita.github.io/yomitoku/commercial_use_guideline/


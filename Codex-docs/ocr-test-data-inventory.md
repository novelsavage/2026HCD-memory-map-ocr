# OCR/カード生成テストデータ整理

作成日: 2026-06-15

## record別分類

| record | 分類 | 用途 | 状態 |
|---|---|---|---|
| `HCD-20260613-141847-A9UJ` | 正常系 | カード生成/R2送信の主テスト | cropあり、OCR成功、レビュー済み、位置情報あり、R2送信済み |
| `HCD-20260612-121502-CFEX` | 正常系だが位置情報不足 | レビュー補正済み本文のカード生成fixture | cropあり、OCR成功、レビュー済み、位置情報なしのためR2ブロック |
| `HCD-20260612-121512-JLF4` | 正常系寄りだが位置情報不足 | cropなしfallback確認 | cropなし、OCR成功、位置情報なしのためR2ブロック |
| `HCD-20260613-063842-56NI` | 異常系 | 非付箋/ノイズOCR確認 | PC/机上写真。`excludeFromPublish = true` に整理 |
| `HCD-20260615-030615-39JQ` | 異常系 | 非付箋/誤承認データ確認 | 画面撮影。`excludeFromPublish = true` に整理 |
| `HCD-20260615-024308-U4B5` | 異常系 | OCR workerの非付箋入力確認 | captured / OCR未実行 |
| `HCD-20260615-024412-ABU4` | 異常系 | OCR workerの非付箋入力確認 | captured / OCR未実行 |
| `HCD-20260610-090935-3QH8` | 除外候補 | 失敗sentinel | 1x1 smoke PNG、OCR failed |

## OCR用の画像フォルダ

正常系OCR crop:

```text
OCR用の画像/2026-06-09/sam-preview/top-crops-for-ocr/
```

代表:

- `IMG_20260612_172453829_sam_crop_00.jpg`
- `IMG_20260612_172520184_sam_crop_00.jpg`

耐性/異常系:

```text
OCR用の画像/コントラストテスト用/
OCR用の画像/capture_*.png
```

手書きメモ単体素材:

```text
OCR用の画像/omide/IMG_7608.jpg` から `IMG_7635.jpg`
```

これは地図座標付きWebApp recordとは別系統なので、OCR単体評価に使う。

## 確認済みfixture

生成済みカード:

```text
outputs/webapp-captures/reitaku-hcd-2026/generated-cards/20260613T141847Z_HCD-20260613-141847-A9UJ_v18_35.833956_139.956178.png
```

位置情報なしfixture:

```text
outputs/card-generation-fixtures/20260612T121502Z_HCD-20260612-121502-CFEX_0.000000_0.000000.png
```

長文/未知ジャンル/空ニックネームfixture:

```text
outputs/card-generation-fixtures/long-text_unknown-genre_empty-nickname.png
```

## 運用ルール

- R2公開対象は `published` かつ `excludeFromPublish = false` かつレビュー後本文あり。
- Unity案Aのため、公開対象は緯度経度必須。
- 非付箋写真やUI確認用写真は `excludeFromPublish = true` にする。
- 位置情報なしの古い正常系recordは、座標を補完するまでR2送信しない。

# HCD Capture Hub

X1 Carbonで動かす現地ハブWebアプリです。スマホから画像をアップロードし、X1の `outputs/webapp-captures/` に画像と `record.json` を保存します。

## 開発起動

```powershell
npm run dev
```

スマホのブラウザカメラを使う場合はHTTPS起動します。

```powershell
npm run dev:https
```

スマホからアクセスする場合は、X1とスマホを同じWi-Fiに接続し、X1のIPアドレスで開きます。

```text
http://<x1-ip>:3000
```

HTTPS起動時:

```text
https://<x1-ip>:3000
```

このプロジェクトではX1のIPアドレス入り証明書を使います。

```text
certificates/x1-local.pem
certificates/x1-local-key.pem
```

Next.jsが作成したルート証明書:

```text
C:\Users\Mori\AppData\Local\mkcert\rootCA.pem
```

スマホで証明書警告が出る場合は、`rootCA.pem` をスマホへ送り、信頼済み証明書としてインストールします。

Android:

1. `rootCA.pem` をスマホへ送る
2. 設定からCA証明書としてインストールする
3. Chromeを開き直す
4. `https://<x1-ip>:3000` を開く

iPhone:

1. `rootCA.pem` をAirDropやメール等で送る
2. プロファイルとしてインストールする
3. 設定 > 一般 > 情報 > 証明書信頼設定 で完全信頼をオンにする
4. Safari/Chromeを開き直す
5. `https://<x1-ip>:3000` を開く

`net::ERR_CERT_COMMON_NAME_INVALID` が出る場合は、localhost用証明書で起動している可能性があります。`npm run dev:https` を使って起動してください。

## 画面

- `/`: メンバー用アップロード画面
- `/admin`: X1管理画面

## HCD現地運用

スマホのブラウザカメラを使う本番寄りの運用では、自己署名HTTPSではなく Cloudflare Tunnel を使います。

### 1. X1でWebAppを本番モード起動

PowerShell 1:

```powershell
cd C:\Projects\OCR\WebApp
npm run build
npm run start
```

起動後、X1では以下で開けます。

```text
http://localhost:3000
```

管理画面:

```text
http://localhost:3000/admin
```

### 2. Cloudflare Tunnelを起動

PowerShell 2:

```powershell
cloudflared tunnel --url http://localhost:3000
```

以下のようなURLが表示されます。

```text
https://xxxxx.trycloudflare.com
```

このURLをスマホで開きます。

### 3. 複数スマホで使う

複数のスマホから使う場合も、同じ Cloudflare Tunnel URL を全員で開いてOKです。

```text
https://xxxxx.trycloudflare.com
```

各スマホで入力するもの:

- 担当者名
- 担当場所
- 端末名

撮影された画像は、X1のローカルに保存されます。

```text
C:\Projects\OCR\outputs\webapp-captures\reitaku-hcd-2026\
```

画像:

```text
outputs\webapp-captures\reitaku-hcd-2026\captures\
```

各画像の記録:

```text
outputs\webapp-captures\reitaku-hcd-2026\records\
```

全件まとめ:

```text
outputs\webapp-captures\reitaku-hcd-2026\manifest.json
```

### 4. 当日の確認

X1の管理画面で受信状況を確認します。

```text
http://localhost:3000/admin
```

確認するもの:

- 受信件数
- 未送信件数
- エラー件数
- 画像一覧
- 担当者名
- 担当場所
- 端末名

### 5. 終了時

終了時は以下を止めます。

- `npm run start` を実行しているPowerShell
- `cloudflared tunnel --url http://localhost:3000` を実行しているPowerShell

Cloudflare TunnelのURLは一時URLです。PowerShellを閉じると使えなくなり、次回起動時には別URLになる可能性があります。

## 運用上の注意

- Cloudflare Tunnel URLは全員で同じものを使ってよい
- URLはイベント中にメンバーへ共有する
- `npm run start` と `cloudflared` の両方を起動し続ける
- X1がスリープすると受信できなくなるため、電源接続とスリープ無効化を推奨
- スマホ側でカメラ許可を求められたら許可する
- うまく撮れない端末は `FILE FALLBACK` の画像選択を使う
- Cloudflareの一時Tunnelは本番保証がないため、長時間運用前に必ず事前テストする
- 来場者の個人情報を書きすぎない運用にする

## トラブルシュート

### スマホでカメラが起動しない

スマホ側のカメラ診断を確認します。

期待値:

```text
secure: true
mediaDevices: true
getUserMedia: true
protocol: https:
host: xxxxx.trycloudflare.com
```

確認すること:

- Cloudflare Tunnel URLで開いているか
- Chrome/Safariでカメラ権限を許可しているか
- 他アプリがカメラを使っていないか
- ページを再読み込みしたか

### スマホで送信したのに管理画面に出ない

確認すること:

- X1の `npm run start` が動いているか
- `cloudflared` が動いているか
- X1がスリープしていないか
- 管理画面を更新したか

### Cloudflare URLが開けない

確認すること:

- `cloudflared tunnel --url http://localhost:3000` のPowerShellが開いたままか
- 表示されたURLを正確に使っているか
- X1がインターネットに接続されているか

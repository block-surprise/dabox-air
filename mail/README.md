# MailBox — GitHub Pages UI修正版

## 今回の修正
- iPhoneの入力時ズームを抑える設定（viewport、16px入力欄、touch-action）
- モバイルのハンバーガーメニューに閉じるボタンと背景タップで閉じる操作を追加
- メール作成・アカウント追加などのモーダルを開くとメニューを自動で閉じる
- 上部バー・検索欄・テーマアイコンを選択中のテーマカラーに連動
- 背景写真の上にかかる色味をテーマカラーに連動
- 右上の何もしない「M」アイコンを削除
- メニューの迷惑メール・ゴミ箱などのアイコンを統一したSVGアイコンに変更
- メールが少ない場合もコンテンツ領域を画面下部まで伸ばし、背景写真が下まで見えるよう調整
- iPhoneの画面下部セーフエリアに対応

## GitHub Pagesへの配置
このZIPの中身（`index.html`、`styles.css`、`app.js`、`manifest.webmanifest`など）を、GitHubリポジトリの公開対象フォルダの直下に置いてください。

1. GitHubで対象リポジトリを開く
2. ZIPを展開し、中身をリポジトリのルートにアップロード
3. `Settings` → `Pages` を開く
4. `Deploy from a branch` を選択
5. ブランチを `main`、フォルダを `/ (root)` にして保存
6. 公開URLをiPhoneのSafariで開く

## Yahoo!メールについての重要な注意
GitHub PagesはHTML/CSS/JavaScriptを配信する静的ホスティングです。Node.jsの`server.js`を実行できません。そのため、GitHub Pagesに置いただけではYahoo!メールのIMAP/SMTP接続は動作しません。

Yahoo!メールの実接続には、IMAP/SMTP通信と認証情報を安全に扱うバックエンドが別途必要です。現在同梱している`server.js`はローカルPCでの単一ユーザー開発用で、GitHub Pagesからの公開接続や複数ユーザー向けの認証機能はありません。**このまま一般公開サーバーへ配置しないでください。** 認証・ユーザー分離・CORS許可リスト・レート制限・安全な秘密情報管理を追加してから、バックエンドを別途ホスティングしてください。

## ローカルでYahoo!メールを試す場合
Node.js 20以降が必要です。

1. `npm install`
2. `.env.example` を `.env` にコピー
3. `MAILBOX_ENCRYPTION_KEY` に64桁の16進数キーを設定
   - 生成例: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. `npm start`
5. `http://127.0.0.1:8787` を開く

このローカル版はローカルPCでの動作確認用です。iPhoneから同じPC上のバックエンドへ接続するには、別途ネットワーク設定が必要です。

## 含まれるファイル
- `index.html` / `styles.css` / `app.js`: Web画面
- `manifest.webmanifest`: PWAメタデータ
- `server.js`: ローカル開発用Yahoo! IMAP/SMTPバックエンド
- `package.json`: Node.js依存関係
- `.env.example`: 環境変数の例

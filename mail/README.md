# MailBox — Firebaseログイン統合版

## このZIPで行ったこと
- 既存のMailBox画面・メニュー・テーマ・iPhone向けレイアウトを維持
- `index.html` から `auth.js` を読み込むように変更
- Firebase Authenticationのログイン画面を追加
- メールアドレス＋パスワードでログイン／新規登録
- Google、Microsoft、AppleのリダイレクトログインUI
- パスワード再設定、ログアウト
- iPhone Safariで入力欄にフォーカスした際の拡大を避けるため、入力欄を16px以上に調整

## 含まれるファイル
- `index.html` / `styles.css` / `app.js`: MailBoxの画面
- `auth.js`: Firebase Authentication
- `manifest.webmanifest`: PWA設定
- `package.json`: ローカル開発用Node.js依存関係
- `server.js`: 旧Yahoo!メールのローカル試作用サーバー（後述の注意を必ず確認）

## Firebase側で必要な設定
Firebase Consoleのプロジェクト `koyomi-96cd7` を開きます。

1. Authentication → Sign-in methodで Email/Password を有効にする
2. Googleを有効にする
3. Microsoftを有効にし、Microsoft Entra側のアプリ登録情報を設定する
4. Appleを有効にし、Apple Developer側のServices ID等を設定する
5. Authentication → Settings → Authorized domains に、公開するサイトのドメインを追加する

MicrosoftのClient SecretやAppleの秘密鍵は、`auth.js` やGitHubに書き込まないでください。Firebase Console／各プロバイダーの安全な設定画面で設定します。

## GitHub Pagesへの配置
ZIPを展開し、公開フォルダにあるファイルを同じ階層に配置します。`index.html` と `auth.js` は同じ階層に置いてください。
GitHub Pagesの設定は、Settings → Pagesから現在の公開方式に合わせて設定します。

## 重要：メール送受信について
このZIPで追加されるのは **MailBox自体へのログイン機能** です。Gmail、Outlook、Yahoo!メール等の受信・送信機能が完成するわけではありません。現在の `app.js` はサンプル表示が中心で、Gmail／Outlook／その他IMAPの実接続は未実装です。

## 重要：server.jsを公開しないでください
同梱の `server.js` は旧来の単一ユーザー・ローカル試作用です。Firebase IDトークンの検証、ユーザーごとのアカウント分離、公開用CORS制限、レート制限、永続DBなどが実装されていません。
**Render等の公開サーバーへ、このままデプロイしないでください。** また、GitHub PagesからYahoo!メールのIMAP/SMTP接続を直接行うことはできません。

公開環境でメール送受信を実装するには、Firebase Admin SDKでIDトークンを検証するバックエンドと、UIDごとのデータ分離・暗号化保管・適切なDBが別途必要です。

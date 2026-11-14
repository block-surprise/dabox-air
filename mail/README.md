# MailBox Cloud — Yahoo!メール接続スターター

このパッケージは、MailBoxの既存UI/Firebaseログインを残し、Yahoo! JAPANメールのIMAP受信・SMTP送信をCloud Runで処理するための**クラウド用スターター**です。PCをサーバーとして使いません。GitHubへの自動書き込みも行いません。

## 重要：まだ公開・接続済みではありません

ZIPを展開してGitHub Pagesへ置いただけでは送受信できません。Cloud Run、Firestore、Firebase Authenticationの設定とデプロイが必要です。デプロイ後、`frontend/api-config.js` にCloud RunのHTTPS URLを設定してからGitHub Pagesへ反映してください。

## 構成

- `frontend/`: MailBox画面、Firebaseログイン、Cloud API呼び出し
- `backend/`: Cloud Run用Node.js API
- Firebase Authentication IDトークンを各APIで検証
- Firestoreは `users/{Firebase UID}/mailboxes/{mailbox ID}` に分離して保存
- Yahoo!メールのパスワードはAES-256-GCMで暗号化してFirestoreへ保存
- IMAP: `imap.mail.yahoo.co.jp:993` SSL
- SMTP: `smtp.mail.yahoo.co.jp:465` SSL

## 公開前に必要な設定

1. Google Cloudプロジェクトを用意し、Cloud Run、Firestore、Cloud Buildを有効化する。課金設定が必要になる場合があります。未成年の場合は、保護者と一緒に確認してください。課金設定やカード情報をチャットに送らないでください。
2. FirestoreをNative modeで作成する。
3. Cloud Runの実行サービスアカウントに、Firestoreの読み書き権限を最小限で付与する。
4. Cloud Runへ `backend/` をデプロイする。
5. 環境変数 `MAILBOX_ENCRYPTION_KEY` に、32バイトのランダム値を16進数64文字で設定する。Secret Managerで管理し、ソースコードやGitHubへ絶対に書かない。
6. `ALLOWED_ORIGINS` にGitHub Pagesの**正確なオリジン**を設定する（例: `https://YOUR-ACCOUNT.github.io`。パスは含めない）。
7. デプロイ後にCloud RunのHTTPS URLを `frontend/api-config.js` の `window.MAILBOX_API_BASE` に設定する。
8. `frontend/` のファイルをGitHub Pagesへ配置する。`auth.js` のFirebase設定とGitHub Pagesの承認済みドメインを確認する。

## ローカルでAPIを検証する場合

`backend/` 内で `npm install` の後、環境変数 `MAILBOX_ENCRYPTION_KEY`、`ALLOWED_ORIGINS` とGoogle Cloud Application Default Credentialsを設定して `npm start`。これは開発用の確認手段であり、PCを常時サーバーにする運用を推奨しません。

## Yahoo!メール接続

Yahoo!側でIMAP/POP/SMTPアクセスが許可されていることを確認してください。接続フォームに入力したパスワードはHTTPS経由でAPIへ送られ、サーバー側で暗号化して保存します。パスワードや暗号化キーをチャット、GitHub、スクリーンショットに載せないでください。

## 現在の対応範囲と制限

- 実装対象: Yahoo! JAPANメールの受信一覧、本文取得、SMTP送信、連携解除
- Gmail / Outlook / その他IMAPは画面上の選択肢のみで、OAuth/API連携は未実装
- メールの既読/スター/フォルダ移動、添付ファイル、ページング、送信済みフォルダ同期は未実装
- Cloud Runの公開後に、実際のYahoo!アカウントで必ず接続・送受信テストが必要
- このスターターは本番セキュリティ監査済み製品ではありません。公開前にレート制限、監査ログ、アカウント削除時のデータ削除、Firestoreルール/IAM、Secret Manager設定を確認してください。

## ファイル配置

GitHub Pagesの公開ディレクトリへ `frontend/` の中身を配置します。`backend/` はCloud Runへ別途デプロイします。

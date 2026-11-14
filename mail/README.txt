MailBox Firebase Authentication module

Files:
- auth.js: Firebase Authentication gate with Email/Password, Google, Microsoft, Apple and logout.

Integration:
1. In mail/index.html, change the classic script include to a module:
   <script type="module" src="auth.js"></script>
   Keep app.js included separately as it is currently.
2. Enable Email/Password, Google, Microsoft and Apple in Firebase Console > Authentication > Sign-in method.
3. Configure Microsoft credentials in Microsoft Entra and Apple credentials in Apple Developer. Never put private keys/client secrets in this file or GitHub.
4. Add your deployed domain to Firebase Authentication > Settings > Authorized domains.
5. The current app.js is still a preview and its mail providers are not yet fully connected. Authentication does not itself enable Gmail/Outlook/Yahoo mail sending or receiving.

Important:
- Firebase web API keys are client configuration, not server secrets. Restrict the key in Google Cloud where appropriate.
- Any backend that handles mail must verify Firebase ID tokens and isolate data by Firebase UID.
- Do not deploy the existing server.js publicly; it is a local single-user prototype without authentication or user isolation.

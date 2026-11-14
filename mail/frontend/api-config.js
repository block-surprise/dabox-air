/* Set this to the HTTPS URL of your deployed Cloud Run service, without a trailing slash. */
window.MAILBOX_API_BASE = '';

// Load overrides only after the existing mailbox scripts have initialized.
document.addEventListener('DOMContentLoaded', () => {
  const script = document.createElement('script');
  script.src = 'gmail-integration.js';
  script.async = false;
  document.body.append(script);
});

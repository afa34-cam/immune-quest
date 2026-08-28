# Immune Quest — feedback collector

A tiny Cloudflare Worker that receives anonymous feedback (an optional 1–5
star rating plus optional free text) from the hub and every game's
feedback form, and appends it as one row to a private Google Sheet only
you can see. No email, no account, no IP address, no cookies — the Worker
stores exactly `{timestamp, rating, text}` and nothing else.

## One-time setup

### 1. Create the Google Sheet
- Create a new Google Sheet. Add a header row: `Timestamp | Rating | Feedback`.
- Copy its **Sheet ID** from the URL: `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
- Leave the first tab named `Sheet1` (the default), or update the `range` in `src/index.js` if you rename it.

### 2. Create a Google service account
- Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse one).
- Enable the **Google Sheets API** for that project (APIs & Services → Library).
- Go to IAM & Admin → Service Accounts → Create Service Account. No project-level role is needed.
- Open the new service account → Keys → Add Key → Create new key → JSON. This downloads a `.json` file — keep it private, never commit it.
- In that JSON file, find `client_email` and `private_key`.

### 3. Share the Sheet with the service account
- Open your Google Sheet → Share → paste the service account's `client_email` → give it **Editor** access.

### 4. Deploy the Worker
```bash
npm install -g wrangler   # if you don't already have it
cd feedback-worker
wrangler login
wrangler deploy
```
Wrangler will print the Worker's URL, e.g. `https://immune-quest-feedback.YOUR-SUBDOMAIN.workers.dev`.

### 5. Set the secrets
```bash
wrangler secret put GOOGLE_CLIENT_EMAIL
# paste the "client_email" value from the JSON key, press enter

wrangler secret put GOOGLE_PRIVATE_KEY
# paste the ENTIRE "private_key" value from the JSON key (including the
# -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY----- lines), press enter

wrangler secret put SHEET_ID
# paste the Sheet ID from step 1, press enter

# Optional — restricts which site origins can POST to this Worker:
wrangler secret put ALLOWED_ORIGIN
# e.g. https://afa34-cam.github.io
```

### 6. Point the site at your Worker
Replace the placeholder URL in both of these with the URL Wrangler printed in step 4:
- `index.html` → `const FEEDBACK_ENDPOINT = '...'`
- `games/shared/ui.js` → `const GAME_FEEDBACK_ENDPOINT = '...'`

That's it — feedback submitted from the hub or any game now lands as a new row in your Sheet within a second or two.

## Testing it

```bash
curl -X POST https://immune-quest-feedback.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"rating": 4, "text": "test submission"}'
```
A new row should appear in your Sheet. `wrangler tail` (run from this folder) streams live logs from the deployed Worker if something isn't working.

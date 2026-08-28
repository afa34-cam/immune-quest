# Immune Quest — feedback collector (Google Apps Script)

A script bound directly to a Google Sheet that receives anonymous feedback
(an optional 1–5 star rating plus optional free text) from the hub and
every game's feedback form, and appends it as one row. No email, no
account, no IP address, no cookies — the sheet gets exactly
`{timestamp, rating, text}` per submission and nothing else.

This runs entirely inside your own Google account — no Google Cloud
project, no service account, no downloadable key. That matters if you're
using a university/work Google Workspace account: those often disable
service-account key creation via org policy, which is what a Cloud-project
based approach would need. Apps Script sidesteps that entirely.

## One-time setup

### 1. Create the Sheet and attach the script
1. Create a new Google Sheet (any name — e.g. "Immune Quest Feedback"). Add a header row: `Timestamp | Rating | Feedback`.
2. In the Sheet, go to **Extensions → Apps Script**. This opens a script editor already bound to this specific sheet.
3. Delete the placeholder `myFunction() {}` code and paste in the contents of `Code.gs` from this folder.
4. **Restrict the permission scope** (important — skip this and the authorization step later will ask for access to *every* Sheet in your Drive, not just this one):
   - Click the gear icon (**Project Settings**) in the left sidebar.
   - Check **"Show 'appsscript.json' manifest file in editor"**.
   - Go back to the editor (left sidebar → **Editor**, the `<>` icon), open the now-visible `appsscript.json` file, and replace its contents with `appsscript.json` from this folder — the key part is `oauthScopes: ["https://www.googleapis.com/auth/spreadsheets.currentonly"]`, which limits the script to only this one spreadsheet.
5. Save the project (File → Save, or ⌘S / Ctrl+S). Give it a name if prompted, e.g. "Feedback Collector".

### 2. Deploy it as a Web App
1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Fill in:
   - **Execute as:** Me (your own account)
   - **Who has access:** Anyone
4. Click **Deploy**. The first time, Google will ask you to authorize the script — click through the consent screen (it'll warn "Google hasn't verified this app" since it's your own personal script; click **Advanced → Go to (your project name)** to proceed). With the manifest change from step 1.4 in place, the permission it actually asks for should read something like *"See, edit, create, and delete only the specific Google Drive files you use with this app"* — scoped to this one spreadsheet, not *"all your Google Sheets spreadsheets"*. If you see the broader wording, go back and double-check the `appsscript.json` change was saved before deploying.
5. Copy the **Web app URL** it gives you — looks like `https://script.google.com/macros/s/AKfycb.../exec`. That's your feedback endpoint.

### 3. Point the site at it
Replace the placeholder URL in both of these with the Web app URL from step 2:
- `index.html` → `const FEEDBACK_ENDPOINT = '...'`
- `games/shared/ui.js` → `const GAME_FEEDBACK_ENDPOINT = '...'`

That's it — feedback submitted from the hub or any game now lands as a new row in your Sheet within a second or two.

## Testing it

```bash
curl -X POST https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec \
  -H "Content-Type: text/plain" \
  -d '{"rating": 4, "text": "test submission"}'
```
A new row should appear in your Sheet.

## If you ever update Code.gs

Editing the script alone isn't enough to update a live deployment — after
saving changes, go to **Deploy → Manage deployments**, click the pencil
icon on the existing deployment, and choose **New version** (this keeps
the same URL, so you don't need to update the site again). Creating a
*new* deployment instead would give you a different URL.

## Privacy notes

- The `appsscript.json` manifest (step 1.4) restricts the script's own
  permissions to just this one spreadsheet (`spreadsheets.currentonly`) —
  without it, Apps Script defaults to requesting access to every Sheet in
  your Drive, not just this one.
- The Sheet's data stays exactly as private as you've set it — only your
  Google account (and anyone you explicitly share it with) can read it.
- "Anyone" access on the deployment only controls who can *submit* — the
  script never reads back or returns existing rows, so the public
  endpoint can't be used to extract past submissions.
- Like any public, unauthenticated form, someone could in principle script
  spam submissions. Nothing sensitive would be exposed if that happened
  (no PII is ever collected), just junk rows to delete — not worth extra
  engineering for a small feedback box, but worth knowing.

// Immune Quest — anonymous feedback collector (Google Apps Script version).
//
// Paste this into the Apps Script editor bound to your feedback Google
// Sheet (Extensions -> Apps Script, from inside the Sheet itself), then
// deploy as a Web App. See README.md in this folder for full setup.
//
// Runs as the Sheet's owner ("Execute as: Me") — no service account, no
// Google Cloud project, no downloadable key of any kind, so none of the
// org-policy restrictions a managed Workspace account can hit (service
// account key creation disabled, etc.) ever come into play. The Sheet's
// own sharing stays exactly as private as you've set it; only this one
// doPost() entry point is reachable publicly, and it only ever WRITES a
// new row — it never reads back or exposes existing submissions.
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Rating is optional (0 = not rated); text capped well above anything
    // a real comment would need, just so one bad-faith POST can't write
    // an enormous row.
    var rating = (typeof data.rating === 'number' && data.rating >= 0 && data.rating <= 5)
      ? Math.round(data.rating) : 0;
    var text = (typeof data.text === 'string') ? data.text.slice(0, 2000).trim() : '';

    if (!text && !rating) {
      return jsonResponse({ ok: false, error: 'empty submission' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    sheet.appendRow([new Date(), rating || '', text]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Immune Quest — anonymous feedback collector.
//
// Receives {rating, text} from the hub's and every game's feedback form
// (see submitFeedback()/gameSubmitFeedback() in index.html / games/shared/
// ui.js) and appends it as one row to a private Google Sheet. Nothing else
// is collected or stored — no email, no account, no IP address written
// anywhere, no cookies set. See README.md in this folder for one-time
// setup (Google service account + Sheet + `wrangler secret put`).

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
    }

    // Rating is optional (0 = not rated); text capped well above anything
    // a real comment would need, just to keep one bad-faith POST from
    // writing an enormous row.
    const rating = Number.isInteger(body.rating) && body.rating >= 0 && body.rating <= 5 ? body.rating : 0;
    const text = typeof body.text === 'string' ? body.text.slice(0, 2000).trim() : '';
    if (!text && !rating) {
      return new Response('Empty submission', { status: 400, headers: corsHeaders });
    }

    try {
      const accessToken = await getAccessToken(env);
      const timestamp = new Date().toISOString();
      // Sheet1 = the default first-tab name a new Google Sheet already
      // has — rename your own tab to match, or change this, if you used
      // something else. Columns: A=timestamp, B=rating (blank if unrated),
      // C=feedback text.
      const range = 'Sheet1!A:C';
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [[timestamp, rating || '', text]] }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return new Response('Sheet append failed: ' + errText, { status: 502, headers: corsHeaders });
      }
      return new Response('OK', { status: 200, headers: corsHeaders });
    } catch (e) {
      return new Response('Server error: ' + e.message, { status: 500, headers: corsHeaders });
    }
  },
};

// Exchanges the service account's private key for a short-lived Google API
// access token (standard JWT-bearer OAuth2 flow) — done on every request
// rather than cached, since a Worker instance's lifetime is unpredictable
// and this endpoint is low-traffic enough that the extra round trip is a
// non-issue.
async function getAccessToken(env) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64urlFromBytes = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base64urlFromString = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const headerB64 = base64urlFromString(JSON.stringify(header));
  const claimsB64 = base64urlFromString(JSON.stringify(claims));
  const signingInput = `${headerB64}.${claimsB64}`;

  const key = await importPrivateKey(env.GOOGLE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64urlFromBytes(signature)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// Accepts the private key exactly as it appears in the service account's
// downloaded JSON — whether pasted with real newlines or with literal
// backslash-n escape sequences still intact (both show up in practice
// depending on how it gets copied into a `wrangler secret put`).
async function importPrivateKey(pem) {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

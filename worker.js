/* ==========================================================================
   ClutchAI — backend (Cloudflare Worker)
   --------------------------------------------------------------------------
   This is the ONLY place your Gemini API key AND your Splitwise credentials
   ever live. They're read from environment variables you set in the
   Cloudflare dashboard — never in this file, never in the frontend, never
   in GitHub.

   This one Worker now handles two things, routed by URL path:

   1. "/" (any path NOT starting with /splitwise) — unchanged from before.
      Accepts a POST from the ClutchAI frontend with { system, prompt },
      calls Gemini server-side, returns the generated text.

   2. "/splitwise/*" — new. Lets a student connect their real Splitwise
      account so their actual shared-expense balances flow into ClutchAI's
      Financial Twin automatically, instead of being typed in by hand.
        - GET  /splitwise/connect   → sends the browser to Splitwise's own
                                       login/consent page
        - GET  /splitwise/callback  → Splitwise sends the browser back here
                                       after consent; this exchanges that
                                       for an access token and hands it to
                                       the frontend
        - GET  /splitwise/balances  → given a token, asks Splitwise for the
                                       student's current balances and
                                       returns a clean summary

   Deploy this by pasting it into your Cloudflare Worker (see README.md).
   No build step, no npm install.
   ========================================================================== */

// Any Gemini model on the free tier works here. gemini-3.6-flash is fast,
// inexpensive, and has a generous free quota — good default for this app.
const GEMINI_MODEL = 'gemini-3.6-flash';

// While testing, '*' is simplest. Once your GitHub Pages site is live,
// you can tighten this to your exact site origin, e.g.
// 'https://your-username.github.io'
const ALLOWED_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    // Preflight for cross-origin requests from GitHub Pages
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // ---- Splitwise routes (new) — everything under /splitwise/ ----
    if (url.pathname === '/splitwise/connect') return handleSplitwiseConnect(url, env);
    if (url.pathname === '/splitwise/callback') return handleSplitwiseCallback(url, env);
    if (url.pathname === '/splitwise/balances') return handleSplitwiseBalances(url, env);

    // ---- Everything else — the original Gemini proxy, unchanged ----
    return handleGeminiProxy(request, env);
  },
};

async function handleGeminiProxy(request, env) {
    if (request.method !== 'POST') {
      return json({ error: 'Only POST requests are supported.' }, 405);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing GEMINI_API_KEY. Set it as a secret in your Worker settings.' }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const { system, prompt } = payload || {};
    if (!prompt || typeof prompt !== 'string') {
      return json({ error: 'Missing "prompt" string in request body.' }, 400);
    }

    const geminiBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    };
    if (system && typeof system === 'string') {
      geminiBody.systemInstruction = { parts: [{ text: system }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

    let res, data;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
      data = await res.json();
    } catch (err) {
      return json({ error: 'Could not reach Gemini API: ' + (err.message || String(err)) }, 502);
    }

    if (!res.ok) {
      return json({ error: data?.error?.message || `Gemini API error (${res.status})` }, res.status);
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('');

    if (!text) {
      return json({ error: 'Gemini returned an empty response (it may have been blocked by safety filters).' }, 502);
    }

    return json({ text });
}

/* ==========================================================================
   Splitwise — OAuth2 connect + balance lookup
   ========================================================================== */

// The exact address Splitwise sends the student back to after they log in
// and approve access. Must be registered in your Splitwise app settings
// EXACTLY as this Worker's own URL + "/splitwise/callback".
function callbackUrl(env) {
  return `${env.WORKER_URL}/splitwise/callback`;
}

// Step 1 — send the browser to Splitwise's own login/consent screen.
async function handleSplitwiseConnect(url, env) {
  if (!env.SPLITWISE_CLIENT_ID || !env.WORKER_URL) {
    return json({ error: 'Server is missing SPLITWISE_CLIENT_ID or WORKER_URL.' }, 500);
  }
  const authorizeUrl = new URL('https://secure.splitwise.com/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.SPLITWISE_CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(env));
  return Response.redirect(authorizeUrl.toString(), 302);
}

// Step 2 — Splitwise redirects back here with a one-time ?code=. Exchange it
// for an access token, then bounce the browser back to the ClutchAI site
// with that token attached, so the frontend can pick it up and store it.
async function handleSplitwiseCallback(url, env) {
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');
  const frontend = (env.FRONTEND_URL || '').replace(/\/$/, '');

  if (!frontend) return json({ error: 'Server is missing FRONTEND_URL.' }, 500);

  if (errorParam || !code) {
    return Response.redirect(`${frontend}/?splitwise_error=${encodeURIComponent(errorParam || 'No code returned by Splitwise.')}`, 302);
  }

  try {
    const tokenRes = await fetch('https://secure.splitwise.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SPLITWISE_CLIENT_ID,
        client_secret: env.SPLITWISE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl(env),
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData?.error_description || tokenData?.error || `Token exchange failed (${tokenRes.status})`;
      return Response.redirect(`${frontend}/?splitwise_error=${encodeURIComponent(msg)}`, 302);
    }
    return Response.redirect(`${frontend}/?splitwise_token=${encodeURIComponent(tokenData.access_token)}`, 302);
  } catch (err) {
    return Response.redirect(`${frontend}/?splitwise_error=${encodeURIComponent(err.message || 'Could not reach Splitwise.')}`, 302);
  }
}

// Step 3 — given a token the frontend already has, fetch this student's
// real balances from Splitwise and return a small, clean summary.
async function handleSplitwiseBalances(url, env) {
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'Missing ?token=' }, 400);

  let res, data;
  try {
    res = await fetch('https://secure.splitwise.com/api/v3.0/get_friends', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    data = await res.json();
  } catch (err) {
    return json({ error: 'Could not reach Splitwise: ' + (err.message || String(err)) }, 502);
  }

  if (!res.ok) {
    return json({ error: data?.error || `Splitwise API error (${res.status})` }, res.status);
  }

  const friends = (data.friends || [])
    // Sum every currency this friend's balance is split across — a
    // simplification that assumes one currency per user, true for most
    // students. Multi-currency users will see a combined number.
    .map((f) => ({
      name: [f.first_name, f.last_name].filter(Boolean).join(' '),
      amount: (f.balance || []).reduce((s, b) => s + Number(b.amount || 0), 0),
    }))
    .filter((f) => Math.abs(f.amount) > 0.01)
    .sort((a, b) => a.amount - b.amount);

  const owedToYou = friends.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const youOwe = friends.filter((f) => f.amount < 0).reduce((s, f) => s + Math.abs(f.amount), 0);

  return json({
    netBalance: owedToYou - youOwe,
    owedToYou,
    youOwe,
    friends,
  });
}

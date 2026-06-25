// Vercel Serverless Function: mint short-lived ephemeral tokens.
//
// The real OPENAI_API_KEY lives ONLY here (Vercel env var) and is never sent to
// the phone. The browser calls GET /api/token, gets ~1-min tokens, and uses them
// to open WebSockets straight to OpenAI.
//
// BIDIRECTIONAL: we mint TWO tokens — one session that outputs Korean, one that
// outputs English. The browser feeds the SAME mic audio into both; OpenAI
// auto-detects the spoken language and only the session whose output language
// differs from the speech actually translates (the other stays silent). That
// silent/active split is how we tell EN→KO from KO→EN with a single mic.
// Returns { ko, en }.

// Mint one ephemeral token for a translation session with the given output lang.
async function mintToken(apiKey, outLang) {
  const r = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Binds a safety identifier to the ephemeral token server-side.
      "OpenAI-Safety-Identifier": "live-translate-event",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        model: "gpt-realtime-translate",
        audio: {
          // far_field = a room / table mic capturing speakers at conversational
          // distance. Cleans the input before VAD + the model, improving
          // recognition for both people sharing the one mic.
          input: { noise_reduction: { type: "far_field" } },
          output: { language: outLang },
        },
      },
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || "token mint failed";
    throw new Error(`${msg} (${r.status})`);
  }
  // Response shape can be { value, expires_at } or { client_secret: { value }}.
  const token = data.value || data.client_secret?.value || data.client_secret;
  if (!token) throw new Error("no token field in OpenAI response");
  return token;
}

export default async function handler(req, res) {
  const API_KEY = process.env.OPENAI_API_KEY;
  if (!API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    return;
  }

  // The two output languages for the bidirectional pair (overridable).
  const LANG_A = process.env.LANG_A || "ko";
  const LANG_B = process.env.LANG_B || "en";

  try {
    const [ko, en] = await Promise.all([
      mintToken(API_KEY, LANG_A),
      mintToken(API_KEY, LANG_B),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ko, en });
  } catch (e) {
    console.error("token mint failed:", e.message);
    res.status(502).json({ error: e.message });
  }
}

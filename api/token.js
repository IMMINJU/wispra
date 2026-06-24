// Vercel Serverless Function: mint a short-lived ephemeral token.
//
// The real OPENAI_API_KEY lives ONLY here (Vercel env var) and is never sent to
// the phone. The browser calls GET /api/token, gets a ~1-min token, and uses it
// to open a WebSocket straight to OpenAI. The translation config (Korean output)
// is applied client-side via session.update after connecting, so this endpoint
// stays minimal and robust to request-body shape changes.

export default async function handler(req, res) {
  const API_KEY = process.env.OPENAI_API_KEY;
  if (!API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    return;
  }

  try {
    // Translation-specific secret endpoint. The target output language is set
    // HERE at creation time (verified against the live API).
    const r = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        // Binds a safety identifier to the ephemeral token server-side.
        "OpenAI-Safety-Identifier": "live-translate-event",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          model: "gpt-realtime-translate",
          audio: { output: { language: process.env.TARGET_LANG || "ko" } },
        },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("token mint failed:", JSON.stringify(data));
      res.status(r.status).json({ error: data?.error?.message || "token mint failed" });
      return;
    }

    // Response shape can be { value, expires_at } or { client_secret: { value }}.
    const token = data.value || data.client_secret?.value || data.client_secret;
    if (!token) {
      console.error("no token field in response:", JSON.stringify(data));
      res.status(502).json({ error: "no token in OpenAI response" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

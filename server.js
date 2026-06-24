// Local dev server — mirrors the Vercel setup so you can test on your phone
// before (or instead of) deploying.
//
//   • serves the static page from /public
//   • exposes GET /api/token, which mints a short-lived ephemeral token
//     exactly like api/token.js does on Vercel
//
// The browser then connects straight to OpenAI with that token; the API key
// stays in this process and is never sent to the phone.
//
// Run:  npm start   →   open http://<this-machine-ip>:3000 on your phone
// (phone and laptop must be on the same Wi-Fi; getUserMedia needs https OR
//  localhost — see README for the phone-testing note.)

import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error("\n[!] OPENAI_API_KEY is not set. Create a .env file:\n");
  console.error("    OPENAI_API_KEY=sk-...\n");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function mintToken(res) {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
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
      json(res, r.status, { error: data?.error?.message || "token mint failed" });
      return;
    }
    const token = data.value || data.client_secret?.value || data.client_secret;
    if (!token) {
      json(res, 502, { error: "no token in OpenAI response" });
      return;
    }
    json(res, 200, { token });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/token") return void mintToken(res);

  let p = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(__dirname, "public", p);
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Live translate (local):  http://localhost:${PORT}`);
  console.log(`  Open on your laptop, click 시작, allow the mic.`);
  console.log(`  (Phone testing needs https or a tunnel — see README.)\n`);
});

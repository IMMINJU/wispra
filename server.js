// Local dev server — mirrors the Vercel setup so you can test on your phone
// before (or instead of) deploying.
//
//   • serves the static page from /public
//   • exposes GET /api/token, which mints the two short-lived ephemeral tokens
//     (ko + en outputs) exactly like api/token.js does on Vercel
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

// Bidirectional: mint TWO tokens (ko-output + en-output). The browser feeds the
// same mic audio into both sessions; OpenAI auto-detects the spoken language and
// only the session whose output language differs from the speech translates.
// Returns { ko, en }. Mirrors api/token.js on Vercel.
const LANG_A = process.env.LANG_A || "ko";
const LANG_B = process.env.LANG_B || "en";

async function mintOne(outLang) {
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
        audio: {
          // far_field = a room / table mic capturing speakers at conversational
          // distance — right for both people sharing the one mic.
          input: { noise_reduction: { type: "far_field" } },
          output: { language: outLang },
        },
      },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data?.error?.message || "token mint failed") + ` (${r.status})`);
  const token = data.value || data.client_secret?.value || data.client_secret;
  if (!token) throw new Error("no token in OpenAI response");
  return token;
}

async function mintTokens(res) {
  try {
    const [ko, en] = await Promise.all([mintOne(LANG_A), mintOne(LANG_B)]);
    json(res, 200, { ko, en });
  } catch (e) {
    console.error("token mint failed:", e.message);
    json(res, 502, { error: e.message });
  }
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/token") return void mintTokens(res);

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

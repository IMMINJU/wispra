// Bidirectional design verification — proves the "two simultaneous sessions"
// approach the app uses, end to end, with no microphone / no browser.
//
//   - open session A  (output language ko)
//   - open session B  (output language en)
//   - stream the SAME audio into BOTH at once
//   - observe which session emits a translation and which stays silent
//
// Expectation (OpenAI docs: "tries not to translate speech already in the
// selected output language"):
//   * Korean input  -> EN session translates,  KO session silent
//   * English input -> KO session translates,  EN session silent
// That silent/active split is exactly how the app auto-detects direction from a
// single mic feeding both sessions.
//
// Usage:
//   node harness/make-sample.js                         # english sample (existing)
//   node harness/verify-bidi.js harness/sample.pcm en
//
//   node harness/make-ko-sample.js                      # korean sample
//   node harness/verify-bidi.js harness/sample-ko.pcm ko

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("[!] OPENAI_API_KEY not set (.env)"); process.exit(1); }

// resolve the pcm path relative to CWD or the harness dir
const argPath = process.argv[2];
const inputLang = process.argv[3] || "?";
if (!argPath) {
  console.error("usage: node harness/verify-bidi.js <pcm-file> <ko|en>");
  process.exit(1);
}
const pcmPath = [argPath, path.join(__dirname, path.basename(argPath))].find(fs.existsSync);
if (!pcmPath) { console.error(`[!] pcm not found: ${argPath}`); process.exit(1); }

const SAMPLE_RATE = 24000, CHUNK_MS = 40;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
const pcm = fs.readFileSync(pcmPath);
const audioSeconds = pcm.length / 2 / SAMPLE_RATE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nInput: ${audioSeconds.toFixed(1)}s of audio  |  declared language: ${inputLang}`);
console.log(`Opening TWO sessions [KO output] + [EN output]; same audio into both.\n`);

async function mintToken(outLang) {
  const r = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "live-translate-bidi-verify",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: { model: "gpt-realtime-translate", audio: { output: { language: outLang } } },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`token mint (${outLang}) failed ${r.status}: ${JSON.stringify(d)}`);
  const t = d.value || d.client_secret?.value || d.client_secret;
  if (!t) throw new Error(`no token (${outLang}): ${JSON.stringify(d)}`);
  return t;
}

function makeSession(label, outLang, token) {
  const s = { label, outLang, ws: null, ready: false, parts: [], live: "", firstDeltaAt: null, charCount: 0 };
  s.ws = new WebSocket(
    "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate",
    ["realtime", "openai-insecure-api-key." + token]
  );
  s.ws.on("open", () =>
    s.ws.send(JSON.stringify({ type: "session.update", session: { audio: { output: { language: outLang } } } })));
  s.ws.on("message", (raw) => {
    let e; try { e = JSON.parse(raw.toString()); } catch { return; }
    switch (e.type) {
      case "session.updated": s.ready = true; break;
      case "session.output_transcript.delta":
        if (!s.firstDeltaAt) s.firstDeltaAt = Date.now();
        s.live += e.delta ?? ""; s.charCount += (e.delta ?? "").length; break;
      case "session.output_transcript.done":
      case "session.output_transcript.completed":
        if (e.transcript && e.transcript.length) s.live = e.transcript;
        if (s.live.trim()) s.parts.push(s.live.trim());
        s.live = ""; break;
      case "error": console.error(`[${label}] error:`, JSON.stringify(e.error ?? e)); break;
    }
  });
  s.ws.on("error", (err) => console.error(`[${label}] ws error:`, err.message));
  s.send = (b64) => { if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: "session.input_audio_buffer.append", audio: b64 })); };
  s.close = () => { try { s.ws.send(JSON.stringify({ type: "session.close" })); } catch {} };
  s.text = () => (s.parts.join(" ") + " " + s.live).trim();
  return s;
}

const [tokKo, tokEn] = await Promise.all([mintToken("ko"), mintToken("en")]);
const ko = makeSession("KO-out", "ko", tokKo);
const en = makeSession("EN-out", "en", tokEn);

const startWait = Date.now();
while ((!ko.ready || !en.ready) && Date.now() - startWait < 5000) await sleep(100);
console.log(`sessions ready → KO:${ko.ready} EN:${en.ready}\nstreaming…`);

const streamStart = Date.now();
for (let off = 0; off < pcm.length; off += CHUNK_BYTES) {
  const slice = pcm.subarray(off, Math.min(off + CHUNK_BYTES, pcm.length));
  const b64 = slice.toString("base64");
  ko.send(b64); en.send(b64);
  await sleep(CHUNK_MS);
}
console.log("audio sent; flushing…\n");
ko.close(); en.close();
await sleep(4000);

const koLat = ko.firstDeltaAt ? ko.firstDeltaAt - streamStart : null;
const enLat = en.firstDeltaAt ? en.firstDeltaAt - streamStart : null;

console.log("=".repeat(56));
console.log(`RESULT  (input was ${inputLang})`);
console.log("=".repeat(56));
console.log(`KO-output: ${ko.charCount} chars` + (koLat != null ? `, first @ ${koLat}ms` : ", (silent)"));
console.log(`  "${ko.text() || "—"}"`);
console.log(`EN-output: ${en.charCount} chars` + (enLat != null ? `, first @ ${enLat}ms` : ", (silent)"));
console.log(`  "${en.text() || "—"}"`);
console.log("-".repeat(56));

const active = inputLang === "ko" ? en : (inputLang === "en" ? ko : null);
const quiet  = inputLang === "ko" ? ko : (inputLang === "en" ? en : null);
if (active) {
  const ok = active.charCount > 3 && quiet.charCount <= active.charCount * 0.3;
  console.log(ok
    ? `✅ DIRECTION AUTO-DETECTED: [${active.label}] translated, [${quiet.label}] stayed ${quiet.charCount === 0 ? "silent" : "mostly quiet"}.`
    : `⚠️  Ambiguous: active=[${active.label}] ${active.charCount}ch, quiet=[${quiet.label}] ${quiet.charCount}ch — inspect above.`);
}
process.exit(0);

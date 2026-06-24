// Headless end-to-end verification of the translation pipeline.
// Streams a pre-recorded English PCM file into OpenAI exactly the way the phone
// browser does — ephemeral token → WebSocket → session.update(ko) → audio append
// → collect Korean transcript — and reports the translation + latency.
//
//   node harness/make-sample.js   # once, to create harness/sample.pcm
//   node harness/verify.js
//
// This proves the real path (token mint, subprotocol auth, translation config,
// transcript events) works with your real key, with zero microphone/browser/human.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("[!] OPENAI_API_KEY not set (.env)"); process.exit(1); }

const samplePath = path.join(__dirname, "sample.pcm");
if (!fs.existsSync(samplePath)) {
  console.error(`[!] ${samplePath} not found. Run:  node harness/make-sample.js`);
  process.exit(1);
}

const SAMPLE_RATE = 24000;
const CHUNK_MS = 40;                                   // send 40ms slices, realtime-paced
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
const pcm = fs.readFileSync(samplePath);
const audioSeconds = pcm.length / 2 / SAMPLE_RATE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error("\n❌ " + m); process.exit(1); };

console.log(`Sample: ${audioSeconds.toFixed(1)}s of audio (${pcm.length} bytes)\n`);

// ---- 1) mint ephemeral token (same call as api/token.js) ----
console.log("① minting ephemeral token…");
const tokRes = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Safety-Identifier": "live-translate-verify",
  },
  body: JSON.stringify({
    expires_after: { anchor: "created_at", seconds: 600 },
    session: {
      model: "gpt-realtime-translate",
      audio: { output: { language: "ko" } }, // target language set at creation
    },
  }),
});
const tokData = await tokRes.json();
if (!tokRes.ok) fail(`token mint failed (${tokRes.status}): ${JSON.stringify(tokData)}`);
const token = tokData.value || tokData.client_secret?.value || tokData.client_secret;
if (!token) fail(`no token in response: ${JSON.stringify(tokData)}`);
console.log("   ✓ token acquired\n");

// ---- 2) connect WS the same way the browser does (subprotocol auth) ----
console.log("② connecting to OpenAI realtime translations…");
const ws = new WebSocket(
  "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate",
  ["realtime", "openai-insecure-api-key." + token]
);

let streamStartAt = null; // when the first audio chunk was sent
let firstDeltaAt = null;
let audioSent = false;    // true once the whole file has been streamed
let summaryPrinted = false;
const parts = [];        // committed transcript segments
let live = "";           // current streaming segment

const overallTimeout = setTimeout(() => fail("timed out waiting for translation (30s)"), 30000);

ws.on("open", async () => {
  console.log("   ✓ connected\n");
  // configure: input transcription + Korean output (same as index.html)
  // Per the translation guide: confirm the target language after the socket
  // opens. Minimal payload — no session.type, only the output language.
  ws.send(JSON.stringify({
    type: "session.update",
    session: { audio: { output: { language: "ko" } } },
  }));

  console.log("③ streaming audio (realtime-paced)…");
  streamStartAt = Date.now();
  for (let off = 0; off < pcm.length; off += CHUNK_BYTES) {
    const slice = pcm.subarray(off, Math.min(off + CHUNK_BYTES, pcm.length));
    ws.send(JSON.stringify({
      type: "session.input_audio_buffer.append",
      audio: slice.toString("base64"),
    }));
    await sleep(CHUNK_MS);
  }
  audioSent = true;
  console.log("   ✓ all audio sent; waiting for final translation…\n");
  // Safety net: finish a few seconds after audio ends even if no final
  // 'done' event arrives, so the run always terminates.
  setTimeout(finish, 4000);
});

ws.on("message", (raw) => {
  let evt; try { evt = JSON.parse(raw.toString()); } catch { return; }
  switch (evt.type) {
    case "session.updated":
      console.log("   ✓ session configured (ko output)\n");
      break;
    case "session.output_transcript.delta":
      if (!firstDeltaAt) firstDeltaAt = Date.now();
      live += evt.delta ?? "";
      process.stdout.write(evt.delta ?? "");
      break;
    case "session.output_transcript.done":
    case "session.output_transcript.completed":
      if (evt.transcript && evt.transcript.length) live = evt.transcript;
      if (live.trim()) parts.push(live.trim());
      live = "";
      process.stdout.write("\n");
      // Only finish once the whole file is sent — mid-stream 'done' events are
      // just segment boundaries, not the end.
      if (audioSent) setTimeout(finish, 1500);
      break;
    case "error":
      fail(`OpenAI error: ${JSON.stringify(evt.error ?? evt)}`);
      break;
  }
});

ws.on("error", (e) => fail("WebSocket error: " + e.message));
ws.on("close", () => { if (!summaryPrinted) finish(); });

function finish() {
  if (summaryPrinted) return;
  summaryPrinted = true;
  clearTimeout(overallTimeout);
  try { ws.close(); } catch {}

  // Fall back to the still-streaming buffer if no final 'done' committed it
  // (the model may simply stop emitting after the audio ends).
  if (live.trim()) { parts.push(live.trim()); live = ""; }
  const full = parts.join(" ").trim();
  console.log("\n" + "=".repeat(48));
  console.log("RESULT");
  console.log("=".repeat(48));
  if (!full) {
    console.log("⚠️  no Korean transcript received — check model/endpoint.");
    process.exit(2);
  }
  console.log("한국어 번역:\n  " + full + "\n");
  if (firstDeltaAt && streamStartAt) {
    console.log(`첫 자막까지 지연: ~${firstDeltaAt - streamStartAt}ms (첫 오디오 전송 시점 기준)`);
  }
  console.log("\n✅ 파이프라인 정상: 토큰 발급 → WS 연결 → 번역 수신 전부 동작.");
  process.exit(0);
}

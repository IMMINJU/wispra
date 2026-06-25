// Generate an ALTERNATING EN↔KO conversation sample as one 24kHz PCM16 file, so
// the browser demo can show bidirectional translation (and the speaker-color
// switching) with no microphone and no second person.
//
// Each turn is TTS'd separately, then concatenated with a short silence gap so
// gpt-realtime-translate segments the turns cleanly. English turns translate to
// Korean (green), Korean turns translate to English (blue).
//
//   node harness/make-convo-sample.js
//   -> writes harness/sample-convo.pcm   AND   public/sample.pcm (for the demo)

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("[!] OPENAI_API_KEY not set (.env)"); process.exit(1); }

const RATE = 24000;

// The back-and-forth. Alternating languages → the subtitles should alternate
// color (KO subtitle ⇐ EN turn, EN subtitle ⇐ KO turn).
// Kept short (EN→KO→EN→KO, ~12s) so it ships in the repo for the deployed demo.
const TURNS = [
  { lang: "en", voice: "alloy", text: "Hi, nice to meet you." },
  { lang: "ko", voice: "shimmer", text: "네, 만나서 반갑습니다." },
  { lang: "en", voice: "alloy", text: "Tell me about your AI startup in Seoul." },
  { lang: "ko", voice: "shimmer", text: "작은 팀이지만 클로드로 빠르게 제품을 만들고 있어요." },
];

// ~0.7s of silence between turns so the model commits each segment cleanly.
const GAP = Buffer.alloc(Math.round(RATE * 2 * 0.7)); // 16-bit mono zeros

async function tts(text, voice) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "pcm",
      instructions: "Speak clearly at a natural, conversational pace.",
    }),
  });
  if (!res.ok) throw new Error(`TTS failed ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`Synthesizing ${TURNS.length} alternating turns…`);
const parts = [];
for (let i = 0; i < TURNS.length; i++) {
  const t = TURNS[i];
  process.stdout.write(`  [${i + 1}/${TURNS.length}] ${t.lang.toUpperCase()}: "${t.text.slice(0, 40)}…"\n`);
  parts.push(await tts(t.text, t.voice));
  if (i < TURNS.length - 1) parts.push(GAP);
}

const pcm = Buffer.concat(parts);
const harnessOut = path.join(__dirname, "sample-convo.pcm");
const publicOut = path.join(__dirname, "..", "public", "sample.pcm");
fs.writeFileSync(harnessOut, pcm);
fs.writeFileSync(publicOut, pcm); // the demo button serves /sample.pcm
const seconds = pcm.length / 2 / RATE;
console.log(`\nWrote ${harnessOut}`);
console.log(`Wrote ${publicOut}  (demo will use this)`);
console.log(`  ${pcm.length} bytes ≈ ${seconds.toFixed(1)}s, ${TURNS.length} turns (EN↔KO)`);
console.log(`\nReload the browser and click 데모 보기 to see it alternate.`);

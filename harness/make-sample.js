// Generate an English speech sample to drive the verification harness — no human,
// no microphone needed. Uses OpenAI TTS to synthesize event-flavored sentences
// (containing the jargon the real talk will use) as raw 24kHz PCM16, the exact
// format the translation pipeline expects.
//
//   node harness/make-sample.js
//   -> writes harness/sample.pcm  (raw mono PCM16 LE @ 24000 Hz)
//
// Override the text:  SAMPLE_TEXT="..." node harness/make-sample.js

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("[!] OPENAI_API_KEY not set (.env)"); process.exit(1); }

// Sentences chosen to stress the things we care about: event jargon + names +
// numbers + a fireside-chat cadence.
const DEFAULT_TEXT =
  "Hello everyone, thanks for joining us today. " +
  "I'm excited to share my experience building an AI-native fintech startup in Silicon Valley. " +
  "We think a lot about what the world looks like after AGI, and how Korean companies can expand globally. " +
  "Models like Claude are changing how small teams ship products. " +
  "Let's dive into the fireside chat.";

const text = process.env.SAMPLE_TEXT || DEFAULT_TEXT;
const outPath = path.join(__dirname, "sample.pcm");

console.log("Synthesizing sample with OpenAI TTS…");
const res = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
    response_format: "pcm", // 24kHz, 16-bit, mono, little-endian — pipeline-ready
    instructions: "Speak clearly at a natural conference-speaker pace.",
  }),
});

if (!res.ok) {
  console.error("TTS failed:", res.status, await res.text());
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(outPath, buf);
const seconds = buf.length / 2 / 24000; // 2 bytes/sample @ 24kHz
console.log(`Wrote ${outPath}`);
console.log(`  ${buf.length} bytes  ≈ ${seconds.toFixed(1)}s of audio`);
console.log(`  text: "${text.slice(0, 70)}${text.length > 70 ? "…" : ""}"`);
console.log(`\nNext:  node harness/verify.js`);

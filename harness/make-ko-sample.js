// Generate a KOREAN speech sample (OpenAI TTS) as raw 24kHz PCM16 — used by
// verify-bidi.js to exercise the KO→EN direction and the dual-session design
// with no microphone / no human.
//
//   node harness/make-ko-sample.js
//   -> writes harness/sample-ko.pcm  (raw mono PCM16 LE @ 24000 Hz)
//
// Override the text:  SAMPLE_TEXT="..." node harness/make-ko-sample.js

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("[!] OPENAI_API_KEY not set (.env)"); process.exit(1); }

// Korean sentences with event/startup jargon, mirroring the English sample.
const DEFAULT_TEXT =
  "안녕하세요, 만나서 반갑습니다. " +
  "저는 서울에서 인공지능 스타트업을 만들고 있습니다. " +
  "우리 팀은 작은 규모지만 클로드 같은 모델 덕분에 빠르게 제품을 출시하고 있어요. " +
  "오늘 이 대화를 정말 기대하고 있었습니다.";

const text = process.env.SAMPLE_TEXT || DEFAULT_TEXT;
const outPath = path.join(__dirname, "sample-ko.pcm");

console.log("Synthesizing KOREAN sample with OpenAI TTS…");
const res = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
    response_format: "pcm", // 24kHz, 16-bit, mono, little-endian — pipeline-ready
    instructions: "Speak clearly and naturally in Korean at a conversational pace.",
  }),
});
if (!res.ok) { console.error("TTS failed:", res.status, await res.text()); process.exit(1); }

const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(outPath, buf);
const seconds = buf.length / 2 / 24000;
console.log(`Wrote ${outPath}  (${buf.length} bytes ≈ ${seconds.toFixed(1)}s)`);
console.log(`text: "${text.slice(0, 70)}${text.length > 70 ? "…" : ""}"`);
console.log(`\nNext:  node harness/verify-bidi.js harness/sample-ko.pcm ko`);

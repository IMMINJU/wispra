// AudioWorklet: takes mic audio (Float32 @ the context's sample rate), converts
// to little-endian PCM16 @ 24 kHz, and posts it to the main thread in ~20ms
// batches (far fewer postMessage / WebSocket sends → less phone CPU + battery).
//
// When the AudioContext is already 24 kHz (the main path now requests that), the
// resample below is a straight pass-through and the browser has done the high-
// quality, anti-aliased downsample for us. If the context falls back to e.g.
// 48 kHz, this linear-interpolation resample handles it.
//
// gpt-realtime-translate expects little-endian PCM16 @ 24 kHz.

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 24000;
    this.inputRate = sampleRate; // global in AudioWorkletGlobalScope (e.g. 48000)
    this.ratio = this.inputRate / this.targetRate;
    this._frac = 0;              // fractional read position carried across blocks
    this._batch = [];            // accumulated Int16 samples awaiting a flush
    this._flushAt = Math.round(this.targetRate * 0.02); // ~20ms (480 samples @ 24k)
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0]; // mono
    if (!ch || ch.length === 0) return true;

    // Resample inputRate -> 24kHz by linear interpolation. ratio === 1 (context
    // already 24kHz) makes this a pass-through. Convert to Int16 LE as we go and
    // accumulate into the batch buffer.
    let pos = this._frac;
    while (pos < ch.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = ch[i];
      const s1 = i + 1 < ch.length ? ch[i + 1] : s0;
      let s = s0 + (s1 - s0) * frac;
      s = Math.max(-1, Math.min(1, s));
      this._batch.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      pos += this.ratio;
    }
    this._frac = pos - ch.length; // carry leftover into next block

    // Flush once we've gathered ~20ms of audio instead of every 128-sample render
    // quantum — cuts the postMessage / WS message rate by several times. The added
    // buffering latency (≤20ms) is negligible next to the reveal queue's pacing.
    if (this._batch.length >= this._flushAt) {
      const pcm = Int16Array.from(this._batch);
      this._batch.length = 0;
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);

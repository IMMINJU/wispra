// AudioWorklet: takes mic audio (Float32 @ the context's sample rate),
// downsamples to 24 kHz, converts to 16-bit PCM, and posts it to the main thread.
//
// gpt-realtime-translate expects little-endian PCM16 @ 24 kHz.

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 24000;
    this.inputRate = sampleRate; // global in AudioWorkletGlobalScope (e.g. 48000)
    this.ratio = this.inputRate / this.targetRate;
    this._frac = 0; // fractional read position carried across blocks
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0]; // mono
    if (!ch || ch.length === 0) return true;

    // Linear-interpolation downsample from inputRate -> 24kHz.
    const out = [];
    let pos = this._frac;
    while (pos < ch.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = ch[i];
      const s1 = i + 1 < ch.length ? ch[i + 1] : s0;
      out.push(s0 + (s1 - s0) * frac);
      pos += this.ratio;
    }
    this._frac = pos - ch.length; // carry leftover into next block

    // Float32 [-1,1] -> Int16 LE
    const pcm = new Int16Array(out.length);
    for (let k = 0; k < out.length; k++) {
      let s = Math.max(-1, Math.min(1, out[k]));
      pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);

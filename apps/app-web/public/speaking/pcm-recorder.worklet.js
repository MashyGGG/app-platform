/**
 * Forwards raw microphone frames to the main thread, and nothing else.
 *
 * IMPL §4.3: the browser records straight to PCM and uploads one WAV, so that
 * Vercel never needs ffmpeg to produce the uncompressed 16 kHz that phoneme
 * scoring wants (原则 B). A worklet rather than the deprecated
 * ScriptProcessorNode, and a worklet rather than MediaRecorder, because
 * MediaRecorder only ever hands back a compressed container.
 *
 * Plain JS in `public/`: an AudioWorklet module is fetched by URL and evaluated
 * in the audio thread's own global scope, so it cannot go through the bundler.
 */
class PcmRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // Copy: the render quantum buffer is reused by the audio thread on the very
    // next callback, so posting it without a copy sends 128 frames of whatever
    // comes next.
    if (channel && channel.length > 0) this.port.postMessage(new Float32Array(channel))
    return true
  }
}

registerProcessor('pcm-recorder', PcmRecorder)

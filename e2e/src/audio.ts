/**
 * Synthesises the one upload format the product accepts: 16 kHz mono 16-bit WAV.
 *
 * Written out longhand rather than imported from `@app/shared/speaking/wav`, and
 * not committed as a fixture file either. The suite is black box — if the app's
 * own encoder were also the test's encoder, a bug that agreed with itself on
 * both sides would go unnoticed; and a 45-second take is a megabyte of PCM that
 * has no business in git when 20 lines produce it.
 */
const SAMPLE_RATE = 16_000

export function wavTake(seconds: number, hz = 220): Buffer {
  const frames = Math.round(seconds * SAMPLE_RATE)
  const buffer = Buffer.alloc(44 + frames * 2)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + frames * 2, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(frames * 2, 40)

  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 12000),
      44 + i * 2,
    )
  }

  return buffer
}

import { describe, it, expect, vi, afterEach } from 'vitest'
import { resizeAvatar } from './resize-avatar'

// jsdom implements neither createImageBitmap nor canvas encoding, so both are
// stubbed. What's under test is the decision logic — when to re-encode, what
// dimensions to target, and every path that must hand the original file back
// rather than throw — not the browser's own image codec.

function stubBitmap(width: number, height: number) {
  const close = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width, height, close } as unknown as ImageBitmap)
  )
  return { close }
}

/** Captures the canvas the helper draws into, so its size can be asserted. */
function stubCanvas(blob: Blob | null) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
  }
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
  return canvas
}

const bigFile = (type = 'image/jpeg') => new File([new Uint8Array(10)], 'photo.jpg', { type })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resizeAvatar', () => {
  it('downscales the longest edge to 512px and preserves aspect ratio', async () => {
    stubBitmap(2048, 1024)
    const canvas = stubCanvas(new Blob(['x'], { type: 'image/webp' }))

    const { resized } = await resizeAvatar(bigFile())

    expect(resized).toBe(true)
    expect(canvas.width).toBe(512)
    expect(canvas.height).toBe(256)
  })

  it('re-encodes to WebP and renames the file accordingly', async () => {
    stubBitmap(1000, 1000)
    stubCanvas(new Blob(['x'], { type: 'image/webp' }))

    const { file } = await resizeAvatar(bigFile())

    expect(file.type).toBe('image/webp')
    expect(file.name).toBe('photo.webp')
  })

  it('does not upscale an image that is already smaller than the target', async () => {
    stubBitmap(64, 64)
    const canvas = stubCanvas(new Blob(['x'], { type: 'image/webp' }))

    await resizeAvatar(bigFile())

    // Redrawn at its own size, never enlarged to 512.
    expect(canvas.width).toBe(64)
    expect(canvas.height).toBe(64)
  })

  it('returns a small WebP untouched, with nothing to gain from re-encoding', async () => {
    stubBitmap(64, 64)
    const original = new File([new Uint8Array(10)], 'already.webp', { type: 'image/webp' })

    const { file, resized } = await resizeAvatar(original)

    expect(resized).toBe(false)
    expect(file).toBe(original)
  })

  it('hands back the original file when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')))
    const original = bigFile()

    const { file, resized } = await resizeAvatar(original)

    // The server still validates type and size, so a bad file fails there
    // with a real message rather than throwing in the picker.
    expect(resized).toBe(false)
    expect(file).toBe(original)
  })

  it('hands back the original file when the browser cannot encode WebP', async () => {
    stubBitmap(2048, 2048)
    stubCanvas(null)
    const original = bigFile()

    const { file, resized } = await resizeAvatar(original)

    expect(resized).toBe(false)
    expect(file).toBe(original)
  })

  it('releases the decoded bitmap even when encoding fails', async () => {
    const { close } = stubBitmap(2048, 2048)
    stubCanvas(null)

    await resizeAvatar(bigFile())

    expect(close).toHaveBeenCalled()
  })
})

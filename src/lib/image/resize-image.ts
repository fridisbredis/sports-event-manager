/**
 * Downscales and re-encodes an image in the browser before it is uploaded.
 *
 * Why this exists rather than a bigger upload limit: Next.js caps a Server
 * Action's request body at 1 MB by default, and a photo straight from a phone
 * camera is several times that. Raising `serverActions.bodySizeLimit` would
 * lift the ceiling for every action in the app to accommodate one screen.
 * Shrinking first keeps the default cap intact and is better on every other
 * axis too — an avatar is rendered at 80px and an event logo at 72px, so a
 * full-resolution upload is bytes nobody ever sees, paid for again on every
 * roster row and every screen that later loads the picture.
 *
 * WebP at 0.85 keeps a 512px image well under 100 kB in practice. The output
 * is always WebP regardless of what went in, which is why the upload actions
 * accept it alongside JPEG and PNG.
 */

/** Longest edge of the re-encoded image, in pixels. */
const MAX_DIMENSION = 512

const OUTPUT_TYPE = 'image/webp'
const OUTPUT_QUALITY = 0.85

export interface ResizeResult {
  file: File
  /** True when the source was actually re-encoded, false when returned as-is. */
  resized: boolean
}

/**
 * Returns a downscaled WebP copy of `file`, or the original file unchanged if
 * the browser can't decode it (a corrupt image, or a format it doesn't
 * support). Callers still validate size and type server-side — this only
 * makes the common case fit, it is not a security boundary.
 *
 * `fallbackName` names the re-encoded file when the source name has no stem
 * to reuse; it only affects the storage object's name.
 */
export async function resizeImage(file: File, fallbackName = 'image'): Promise<ResizeResult> {
  // createImageBitmap is the cheap path and is supported everywhere this app
  // runs; if it throws, the file isn't a decodable image and the server-side
  // validation will reject it with a proper message.
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { file, resized: false }
  }

  try {
    const { width, height } = bitmap
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))

    // Already small enough and already WebP — nothing to gain by re-encoding.
    if (scale === 1 && file.type === OUTPUT_TYPE) {
      return { file, resized: false }
    }

    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return { file, resized: false }

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY)
    )

    // toBlob yields null if the browser can't encode the requested type.
    if (!blob) return { file, resized: false }

    const renamed = file.name.replace(/\.[^.]+$/, '') || fallbackName
    return {
      file: new File([blob], `${renamed}.webp`, { type: OUTPUT_TYPE }),
      resized: true,
    }
  } finally {
    bitmap.close()
  }
}

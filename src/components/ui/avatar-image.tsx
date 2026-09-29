'use client'

import { useState } from 'react'

interface Props {
  /** Public storage URL, or null/empty when the person has no picture yet. */
  src: string | null | undefined
  /** Shown when there is no picture, or when the one on file fails to load. */
  initials: string
  alt: string
  /** Tailwind sizing/colour for the circle — the caller owns the look. */
  className?: string
  /** Sizing/colour for the initials text inside the fallback circle. */
  initialsClassName?: string
  style?: React.CSSProperties
}

/**
 * A circular avatar that renders an uploaded picture when there is one and
 * falls back to initials when there isn't.
 *
 * The fallback also covers a URL that 404s — a row can hold an avatar_url
 * whose object was removed from the bucket (a failed cleanup, a manual
 * delete), and without onError that renders as a broken-image icon instead of
 * the initials the screen showed before anyone uploaded anything.
 *
 * Plain <img>, not next/image: same choice as the event logo field, since
 * these are user-uploaded storage URLs at small fixed sizes where the
 * optimizer earns little.
 */
export function AvatarImage({
  src,
  initials,
  alt,
  className = '',
  initialsClassName = '',
  style,
}: Props) {
  const [failed, setFailed] = useState(false)

  const showImage = Boolean(src) && !failed

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={style}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={initialsClassName} aria-hidden="true">
          {initials}
        </span>
      )}
    </span>
  )
}

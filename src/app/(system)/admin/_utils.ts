// Swedish letters have to be spelled out rather than stripped of their
// diacritics: å and ä both decompose to "a" under NFD, but Swedish convention
// romanises them the same way, while ö becomes "o". Danish/Norwegian ø and æ
// travel with them, and ß has no decomposition at all — NFD would drop it.
const TRANSLITERATIONS: Record<string, string> = {
  å: 'a',
  ä: 'a',
  ö: 'o',
  ø: 'o',
  æ: 'ae',
  ß: 'ss',
}

export function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[åäöøæß]/g, (char) => TRANSLITERATIONS[char])
      // Everything else accented (é, ü, ñ, …) loses its mark instead of being
      // dropped: NFD splits the letter from its combining mark, and the mark
      // is then removed on its own.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
  )
}

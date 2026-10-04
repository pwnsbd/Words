// Offsets refer to cleaned text, with crossed-out writing removed.
export interface TextPassage { text: string; start: number; end: number }

export function splitPassages(text: string): TextPassage[] {
  const result: TextPassage[] = []
  const max = 900
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + max, text.length)
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf(' ', end))
      if (boundary > start + max / 2) end = boundary
    }
    const raw = text.slice(start, end)
    const trimmed = raw.trim()
    if (trimmed) {
      const offset = start + raw.indexOf(trimmed)
      result.push({ text: trimmed, start: offset, end: offset + trimmed.length })
    }
    if (end === text.length) break
    start = Math.max(start + 1, end - 120)
  }
  return result
}

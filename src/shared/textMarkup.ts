// Shared plain-text markup for "struck through" runs inside a journal
// entry's stored text -- see the writing-mode dial (pencil / quill / ink)
// in App.tsx. In quill mode (once its per-entry correction budget runs
// out) and in ink mode (always), a "delete" doesn't remove a character --
// it marks it struck instead, so the mistake stays visible rather than
// vanishing. That has to survive a save/reload, so it's encoded right into
// entry.text using two Private Use Area code points as start/end markers,
// built via fromCharCode (rather than a literal escape sequence) so this
// source file stays plain ASCII -- one less thing to go wrong when it
// passes through editors/tools that don't round-trip private-use code
// points byte-for-byte. Chosen over something like markdown's ~~text~~
// because real journal prose will essentially never contain them by
// accident, so nothing needs escaping, and they render as nothing/tofu if
// this text is ever shown somewhere that doesn't know the markup exists.
const STRIKE_START = String.fromCharCode(0xe000)
const STRIKE_END = String.fromCharCode(0xe001)

export interface TextRun {
  text: string
  struck: boolean
}

// Char array (as the write surface edits it) -> stored string with markup.
export function serializeRuns(chars: { ch: string; struck: boolean }[]): string {
  let out = ""
  let i = 0
  while (i < chars.length) {
    const struck = chars[i].struck
    let run = ""
    while (i < chars.length && chars[i].struck === struck) {
      run += chars[i].ch
      i++
    }
    out += struck ? STRIKE_START + run + STRIKE_END : run
  }
  return out
}

// Stored string with markup -> ordered runs, for rendering (read view, and
// re-parsing a draft).
export function parseRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  const re = new RegExp(STRIKE_START + "([\\s\\S]*?)" + STRIKE_END, "g")
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), struck: false })
    }
    runs.push({ text: match[1], struck: true })
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), struck: false })
  }
  return runs
}

// Strips struck runs entirely -- used before feeding entry text to the
// reflection/embedding model, and for previews. What's crossed out was, by
// definition, not what the writer meant to leave behind, so the model
// (and short previews elsewhere in the app) should read the entry as if
// it wasn't there at all.
export function stripStruckMarkup(text: string): string {
  const re = new RegExp(STRIKE_START + "[\\s\\S]*?" + STRIKE_END, "g")
  return text.replace(re, "")
}

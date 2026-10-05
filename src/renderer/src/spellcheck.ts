// Fully offline spellcheck for the write surface. The Hunspell en_US
// dictionary (dictionary-en) is read by the main process and handed over
// once through IPC; nspell runs here. Everything is best-effort: if the
// dictionary can't load, `ready()` stays false and nothing is underlined.

import NSpell from 'nspell'

type Char = { ch: string; struck: boolean }
export type SpellRange = { start: number; end: number }

let spell: ReturnType<typeof NSpell> | null = null
let loading: Promise<void> | null = null
// Per-word results, so re-checking a long entry only pays for new words.
const cache = new Map<string, boolean>()

export function spellReady(): boolean {
  return spell !== null
}

export function loadSpellcheck(personalWords: string[]): Promise<void> {
  if (loading) return loading
  loading = window.api
    .getSpellDictionary()
    .then((dict) => {
      if (!dict) return
      const s = NSpell(dict.aff, dict.dic)
      for (const w of personalWords) s.add(w)
      spell = s
    })
    .catch(() => {})
  return loading
}

export function addPersonalWord(word: string): void {
  if (!spell) return
  spell.add(word)
  cache.clear()
}

export function suggestFor(word: string): string[] {
  if (!spell) return []
  try {
    return spell.suggest(word).slice(0, 5)
  } catch {
    return []
  }
}

function isCorrect(word: string): boolean {
  const hit = cache.get(word)
  if (hit !== undefined) return hit
  let ok = true
  try {
    ok = spell ? spell.correct(word) : true
  } catch {
    ok = true
  }
  cache.set(word, ok)
  return ok
}

const LETTER = /[\p{L}\p{M}]/u
const APOSTROPHE = /['’]/
const DIGIT = /[\p{N}_]/u

// Misspelled word ranges (indexes into `chars`). Struck words, words that
// touch struck text, words stuck to digits, ALL-CAPS tokens, and the word
// still being typed at the very end are skipped.
export function findMisspellings(chars: Char[]): SpellRange[] {
  if (!spell) return []
  const out: SpellRange[] = []
  const n = chars.length
  let i = 0
  while (i < n) {
    if (!LETTER.test(chars[i].ch)) {
      i++
      continue
    }
    const start = i
    while (
      i < n &&
      (LETTER.test(chars[i].ch) ||
        (APOSTROPHE.test(chars[i].ch) && i > start && i + 1 < n && LETTER.test(chars[i + 1].ch)))
    ) {
      i++
    }
    const end = i
    if (end === n) continue // still being typed
    let skip = (start > 0 && (chars[start - 1].struck || DIGIT.test(chars[start - 1].ch))) ||
      chars[end].struck || DIGIT.test(chars[end].ch)
    let word = ''
    for (let k = start; k < end; k++) {
      if (chars[k].struck) skip = true
      word += chars[k].ch
    }
    if (skip) continue
    if (word.length > 1 && word === word.toUpperCase()) continue
    if (!isCorrect(word.replace(/’/g, "'"))) out.push({ start, end })
  }
  return out
}

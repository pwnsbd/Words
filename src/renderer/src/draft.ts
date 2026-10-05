export type DraftChar = { ch: string; struck: boolean }
export const DRAFT_KEY = 'words.unsaved-draft.v1'

export interface Draft {
  chars: DraftChar[]
  remainingDeletes: number | null
  mode: 'pencil' | 'quill' | 'ink'
}

export function readDraft(storage: Pick<Storage, 'getItem'>): Draft | null {
  try {
    const value = JSON.parse(storage.getItem(DRAFT_KEY) || 'null')
    if (!value || !Array.isArray(value.chars) ||
      !['pencil', 'quill', 'ink'].includes(value.mode) ||
      !(value.remainingDeletes === null || (Number.isInteger(value.remainingDeletes) && value.remainingDeletes >= 0)) ||
      !value.chars.every((c: DraftChar) => c && typeof c.ch === 'string' &&
        Array.from(c.ch).length === 1 && typeof c.struck === 'boolean')) return null
    return value
  } catch { return null }
}

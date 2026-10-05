declare module 'nspell' {
  interface NSpellInstance {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): NSpellInstance
  }
  export default function nspell(aff: string, dic: string): NSpellInstance
}

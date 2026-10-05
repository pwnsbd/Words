# Contract — Write surface: spellcheck + IME

**Context:** `.write__editor` in `src/renderer/src/App.tsx` (~L723) is a custom `div role=textbox` driven by `handleEditorKeyDown` / `handleEditorPaste` over a char array, so the writing-mode dial (pencil/pen/ink behaviours, struck-through markup) works. That's why native spellcheck and IME composition are lost.

**Inputs:** keyboard input, including IME composition (Windows Japanese/Chinese/Korean IME, emoji panel Win+.), dead keys / accented input.

**Outputs:**
- IME: composed text inserts as normal chars on `compositionend` (preview of in-progress composition shown inline or near the caret); works in every writing mode with that mode's existing rules.
- Spellcheck: misspelled words get a soft underline in the theme's ink colour (not bright red), both themes. Right-click a misspelled word → suggestions from Electron's built-in spellchecker (`session` spellchecker / `context-menu` event `dictionarySuggestions`) or an equivalent offline approach; choosing one replaces the word subject to the writing mode's rules. Everything offline — no network spellcheck service.
- Writing dial and all writing modes behave exactly as today.

**Errors:** spellchecker unavailable → no underlines, writing unaffected. Never lose or duplicate typed characters.

**Perf budget:** no visible typing lag on a 5,000-word entry; spellcheck work debounced/off the keystroke path.

**Out of scope:** grammar checking, language picker UI (use OS/default language), changing writing-mode semantics, redesigning the editor.

**Done-check:** `npm run typecheck` and `npm run build` pass; builder lists how IME + spellcheck were wired and how each writing mode interacts; README "Known gaps" spellcheck/IME line removed and feature noted under "What's built". Visual/feel check done by Conductor + user in the main checkout.

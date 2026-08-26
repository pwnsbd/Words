# Words

A local-first journaling companion. See [words-app-brief.md](./words-app-brief.md) for the product brief.

## What's built

- **Model download, with a one-time consent first.** If either default model file is missing the first time
  you launch the app, a quiet banner on the writing page asks — "Words works better with two local models
  (about 5GB total, downloaded once). Download them now?" — before anything happens; it never blocks typing,
  and it never asks again after you answer either way (tracked by `settings.modelDownloadAsked`). Say yes
  and `src/main/modelDownload.ts` streams the same two files the table below already recommended, straight
  from Hugging Face, to a `.part` file that only gets renamed into place once it's actually complete — so an
  interrupted download is never mistaken for a real model. Progress (and a manual download/retry any time
  after, whether you said "not now" or a download failed) lives in Settings → Local models. Placing your own
  files by hand, as described below, still works exactly as before and skips the download for whichever file
  is already there.
- Write-first entry screen: opens straight to a blank page, no dashboard.
- Save on `Ctrl/Cmd+Enter`. Entries are saved instantly as plain JSON files under your local user data
  folder — nothing is sent anywhere.
- After saving, a soft one-line reflection quietly fades in once the local model responds (this never
  blocks the writing surface — if the model isn't running, the entry still saves fine, just without a line).
  The reflection describes what the entry *sounds like* as writing ("there's a tired, worn-down quality to
  this") rather than diagnosing how you feel ("you're feeling...") — see `REFLECTION_SYSTEM_PROMPT` in
  `src/main/llamacpp.ts`.
- **Resurfacing**: each entry is embedded, and if a genuinely similar entry from 14+ days ago exists, it
  fades in quietly a beat after the reflection: "you wrote something like this on [date]." Never forced —
  most saves won't surface anything, and that's the point. How eager it is ("rarely" / "sometimes" /
  "often") is a Settings option, backed by `RESURFACE_THRESHOLDS` in `src/main/settings.ts`. The lookup
  itself goes through `src/main/similarityIndex.ts` — a `SimilarityIndex` interface with a brute-force,
  in-memory implementation behind it. Fine at least into the low thousands of entries; if it ever needs to
  be smarter (a real vector index) for someone with years of daily entries, that's a new class implementing
  the same interface, not a rewrite of how resurfacing works.
- **Mood mark**: alongside the reflection, the model also rates the entry's emotional weight (-2 to 2,
  never shown as a number). Each entry in the journal view carries a small dot beside its date — denser
  for a heavier day, fainter for a lighter one — sitting right next to the entry it belongs to rather than
  as a separate chart.
- **Recurring themes**: opening the journal view (only there, never on the writing surface, never on a
  timer) checks your last 30 days of reflections for a genuine recurring feeling and — only if one
  clearly exists — surfaces one gentle sentence above the entry list. Needs at least 5 recent entries
  before it even asks the model.
- A small bound-notebook icon, bottom-right of the writing surface (its usual spot, same "line" as the
  Settings mark opposite it), opens the journal — a plain cover and spine, with a black pen resting
  diagonally across it, kept flat and simple at rest. Clicking it gives the whole notebook a tactile
  press-and-spring bounce while the pen wiggles, before the page actually turns.
- Clicking an entry in the journal list opens it full-page (full text + its reflection), with its own
  corner control back to the list.
- **A letter from the past month**: shown as a quiet text link in the journal view (only once you have 5+
  recent entries — otherwise it doesn't offer). Generated on demand, never proactively — a short reflective
  letter from your past month's reflections, written in the app's own gentle voice.
- **Old journal import**: a small "↓ import" control top-right of the journal view (beside Settings) opens a
  native file picker for `.txt`/`.md` files. Each file becomes one backdated entry — dated from a
  `YYYY-MM-DD` in the filename if present, else the file's last-modified date — and gets embedded (so
  resurfacing/search reaches it) but skips reflection/mood generation, to keep a big import fast and because
  that response is meant to be a live, in-the-moment thing, not manufactured after the fact for bulk
  history. PDFs and other journaling apps' export formats aren't supported yet — plain text/markdown only.
- **Entries are permanent — delete only, no edit.** Once saved, an entry can't be changed; a quiet "delete"
  link sits below it in the reading view, needing a second click ("yes, delete" — no native confirm dialog,
  but still a deliberate two-step) to actually remove it. Deliberate: knowing a saved entry can't be quietly
  revised afterward is meant to make the moment of writing it a little more considered.
- **Writing mode**: an actual rotary dial, top-right of the writing surface — drag it around like a watch
  crown (or focus it and use the arrow keys) to turn between three modes — **pencil** (unlimited edits,
  ordinary character-by-character backspace), **quill** (a per-entry budget of whole *words* you can correct,
  default 5, tunable in Settings — a correction is a word, found by splitting on whitespace, not a character,
  so backspace removes a full word at a time; once the budget's spent, that's it, no more edits at all, same
  as after the entry's saved), and **ink** (no real deletions, ever, from the very first keystroke — a delete
  always strikes the whole word through instead of removing it). Striking is ink's actual mechanism, not a
  fallback quill also drops into once its budget runs out — quill just locks once it's spent; only ink lets
  you keep marking mistakes indefinitely. Either way, the mistake stays visible rather than vanishing, in
  both the writing surface and later when reading the entry back. The struck/not-struck state is encoded
  right into the saved entry text (`src/shared/textMarkup.ts`) and stripped back out before that text ever
  reaches the reflection/embedding model or a preview — a crossed-out word isn't part of what the entry is
  "about". The dial's three tick marks are colored green/yellow/red (muted to the app's own palette,
  `--mode-easy/medium/hard` in
  `styles.css`) for how forgiving each mode is; the needle, hub, and mode label pick up that color live as
  you turn it. What each mode actually does is explained in Settings, not on the writing page itself.
- **Two themes**: cream (default) and a muted charcoal dark theme, switchable in Settings. Every color in
  `styles.css` is a CSS variable specifically so this is a complete reskin, not a partial one — including
  the scroll's parchment tone, which goes sepia rather than gray in dark mode to keep reading like paper
  rather than a plain dark-mode panel.
- **Settings**: the same gear mark, same size, in two places — top-right of the journal view (beside
  import) and bottom-left of the writing surface, kept quiet there by opacity alone rather than a smaller
  size. Its back arrow returns wherever it was opened from, not a fixed page. Appearance (theme), resurfacing
  sensitivity, and quill mode's per-entry correction budget live in the Settings screen, along with an
  "About Words" section explaining what the app does and what each writing mode means — the writing surface
  itself stays free of explanation text. The writing mode (pencil/quill/ink) is still switched from its own
  dial on the writing surface, not from here. Model file paths are still env-var-only (see below) to keep
  this from turning into a control panel.
- **App icon**: a small hand-drawn pen-and-ink-trail mark (`resources/icon.svg` — regenerate the `.ico`/
  `.png` via `node scripts/make-icon.mjs` if it's ever redesigned; that script's own dependencies,
  `sharp`/`png-to-ico`, are intentionally *not* in package.json — install them with
  `npm install --no-save sharp png-to-ico` only when regenerating, then `npm ci` to drop them again).
- **Wax seal**: at the bottom of every unrolled scroll — "murky for heavy days, open/airy for light days",
  per the brief. Procedural (`WaxSeal` in `App.tsx`), not a generated image — a real local image-generation
  model was weighed and explicitly set aside in favor of this looking more deliberate instead, since there's
  no mature Node equivalent of node-llama-cpp for image models and nothing I could actually verify runs
  correctly. An SVG circle distorted by an `feTurbulence`/`feDisplacementMap` filter into a slightly
  irregular blob (real wax seals are never perfect circles) — the color blends between `--seal-heavy` and
  `--seal-light` (both theme-aware) by mood via CSS `color-mix()`, and mood also drives the edge itself:
  rougher/more irregular on heavy days, smoother and closer to a true circle on light ones, "murky" and
  "open" as shape as well as color. A pressed-rim shadow and a soft gloss highlight share that same
  distorted edge, and the engraving in the middle is a compact version of the app's own pen-and-ink-trail
  icon mark (see `resources/icon.svg`) — the same signet every time, not an arbitrary squiggle, which is
  what actually makes it read as a seal rather than decoration.

## Known gaps

- **No "regenerate reflection" for an existing entry.** Every entry's reflection/mood is generated once, at
  save time, with whichever model was loaded then. Comparing two models on the same text means re-saving it
  as a fresh entry under each — see `sample-entries.md` for a ready-made set to do that with.
- **Old journal import is `.txt`/`.md` only** — no PDF, no other journaling apps' export formats.
- **Model *choice* is still fixed** — automatic download always fetches the same two default models; there's
  no in-app picker for a different one. Custom filenames/paths are still env-var only (see below), to keep
  Settings from turning into a control panel.
- **No automated tests** — everything's been verified via `npm run typecheck`/`npm run build` plus manual
  testing in the running app.
- **The custom write surface has no spellcheck or IME composition** — a trade-off of replacing the native
  `<textarea>` with a fully React-controlled surface for the writing-mode strikethrough feature.
- **No packaged installer produced yet** (`npm run dist:win` exists and should work, just hasn't been run
  for a real build).

## Requirements

- [Node.js](https://nodejs.org/) 18+ (already detected on this machine).
- Two local model files in GGUF format. Models run **in-process via [node-llama-cpp](https://node-llama-cpp.withcat.ai/)**
  (llama.cpp bindings) — there's no separate service to install or keep running, unlike Ollama. `npm install`
  pulls a prebuilt native binary automatically, with GPU offload via CUDA or Vulkan auto-detected at
  runtime (whichever is actually available — CUDA needs the CUDA Toolkit installed, not just the driver;
  Vulkan usually works out of the box on a recent GPU driver). Run `npx --no node-llama-cpp inspect gpu` to
  see which backend it'll actually use and how much VRAM it sees.

  Create a `models/` folder at the project root and put two `.gguf` files in it:

  | File | What to download |
  |---|---|
  | `models/reflection-model.gguf` | e.g. [Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/blob/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf) (~4.9GB, good quality/size balance for an RTX 5070) |
  | `models/embedding-model.gguf` | e.g. [nomic-embed-text-v1.5.Q4_K_M.gguf](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF) |

  Rename whatever you download to match those two filenames, or point at different filenames/locations via
  env vars instead of renaming:

  ```
  WORDS_MODELS_DIR=C:\path\to\your\models
  WORDS_REFLECTION_MODEL_FILE=some-other-model.gguf
  WORDS_EMBEDDING_MODEL_FILE=some-other-embedder.gguf
  WORDS_GPU_LAYERS=0                 # force CPU-only; omit to auto-fit to VRAM
  ```

  If a model file isn't present, the app still works — entries just save without a reflection/embedding
  until it is.

## Setup

```
npm install
npm run dev
```

This opens the app in a dev window with hot reload. The first reflection after starting the app will be
slower than the rest — that's the model loading into memory once; it stays warm after that.

Or just double-click [Words.bat](./Words.bat) — same thing, no terminal typing required.

The terminal Words prints to on startup will tell you whether it actually found your model files, e.g.:

```
[words] models dir: Z:\PM Journey\Words\models
[words] reflection model: found
[words] embedding model: found
```

If either says "NOT found," double-check the filename and folder against the table above.

If a reflection ever doesn't seem to be arriving, `node scripts/verify-models.mjs` exercises the model
loading + generation pipeline standalone (no Electron, no GUI) and prints what happened — useful for
telling apart a model problem from an app problem.

## Building a standalone Windows install

```
npm run dist:win
```

Produces an installer under `dist/`.

## Where your data lives

Entries are stored as one JSON file per entry under Electron's per-user app data folder, e.g.
`%APPDATA%\words\entries\`. Settings (theme, resurfacing sensitivity) live alongside them in
`%APPDATA%\words\settings.json`. Nothing leaves your machine.

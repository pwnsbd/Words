# Words

A local-first journaling companion. See [words-app-brief.md](./words-app-brief.md) for the product brief.

## Experimental preview

See the [release review and remaining checks](docs/experimental-release-review.md) before distributing a build. Unsaved writing now recovers locally after restart, including strikes and the quill correction budget. Use the visible **save entry** control or **Ctrl+Enter** to save permanently; failures keep the draft and display a message. Recovery is best effort and does not replace a separate backup.

`npm run test:backend` checks storage and model-file failure handling. `npm run test:release` builds the app and tests draft/save behavior in an isolated Electron profile without model downloads or access to your journal.

## Similar thoughts and lightweight models

Words compares overlapping passages, so an idea buried in a long entry can connect to earlier writing with different wording. After saving, up to three matches show the older passage, its date, and an **open entry** link. Opening a saved entry also finds earlier matches. All earlier dates are eligible, including yesterday; the old 14-day exclusion is gone. The source passage remains visible when following a link.

The basic configuration is **Llama 3.1 8B Instruct** for reflections and **Qwen3 Embedding 0.6B Q8_0** for memory. Settings shows this fixed pair; the alternative model selectors have been removed. Older model preferences migrate to this configuration on restart. Missing model files download automatically. No journal content is uploaded; developer environment overrides remain available.

Old whole-entry embeddings are migrated as needed. A model/file/prefix/version identity keeps vectors from different embedding models separate, even if their dimensions match. **Rebuild memory with the active model** processes all saved writing explicitly. See [model assessment and validation](docs/memory-models.md) for recommendations, limitations, and test results.

## Patterns: ideas and ways of thinking

The knotted-thread button directly above the journal opens **Patterns**, in the same paper-and-ink theme. A pattern needs matching passages from at least three different entries on three different days. Every included passage must be similar to every other; a chain of loose matches is not enough. Llama names recurring ideas, philosophical questions or tensions, and explicit ways of reasoning, including questioning assumptions or weighing opposing values. It rejects groups that share only mood or tone and does not assign a personality or philosophical identity. Changes of position can belong to the same recurring question. Dates, counts, and the chronological excerpts come from the entries themselves.

Expand a pattern to read its history, follow an excerpt to the original entry, then return to Patterns. **These aren’t related** dismisses a grouping locally, including substantially overlapping groups that grow later. Deleting a source hides the affected cached pattern immediately; background recalculation uses the remaining entries. Nothing diagnoses the writer or scores their progress.

Analysis upgrades re-check older results while preserving dismissals. Results and dismissals are stored locally in `idea-patterns.json` beside the journal. Saved results load before background updates complete. Updates run after saves, imports, deletions, memory rebuilds, or opening Patterns. If a model is unavailable, the page explains that it cannot finish and offers a retry. No new models or runtime packages are needed.

`npm run test:patterns` checks grouping, distinct dates, model identity, chain rejection, cached labeling, persistent dismissals, deletion, and retry. `electron scripts/smoke-patterns.mjs` (after building and seeding the samples) runs an isolated real-model UI test on copies of the 20 sample entries. Large journals may need a faster clustering/index implementation later; the first version uses a deterministic in-memory scan.

## What's built

- **The models fetch themselves, in the background, on first run.** No prompt. If either GGUF file is
  missing when the app starts, `src/main/index.ts` kicks off `src/main/modelDownload.ts`, which streams the
  selected files straight from Hugging Face into the models folder — to a `.part` file
  renamed into place only once complete, so an interrupted download is never mistaken for a real model. The
  writing page carries a quiet, non-blocking "setting up the local models…" line while it runs (and a soft
  "didn't finish — retry in Settings" line if it fails); typing and saving are never gated on it. Progress
  and a manual retry live in Settings → Local models. `downloadMissingModels()` skips whichever file is
  already present, so dropping your own files in by hand still works and short-circuits the download.
- **By default the models live inside the app, and an uninstall takes them with it.** Packaged, the models
  folder is `<install dir>\models\` — the NSIS uninstaller clears the install directory (plus an explicit
  `RMDir /r "$INSTDIR\models"` in `build/installer.nsh` for the files added post-install), so the models never
  get orphaned. Journal entries live in `%APPDATA%\words\` and normally survive — but the uninstaller now
  **asks** ("Also delete your Words journal?", default No) and wipes `%APPDATA%\words` if you say yes.
  (If the app was installed somewhere unwritable — Program Files with elevation — the models fall back to
  `%APPDATA%\words\models\` and go with the journal in that prompt.) In dev
  the folder is `models/` at the project root.
- **The models folder is yours to move.** Settings → Local models has a "change folder" control (native
  picker, any drive) and "use default location". Either one **moves the existing files** to the new spot
  (rename on the same volume, copy-then-delete across volumes — the UI shows "moving model files…") rather
  than re-downloading, then drops the warm model contexts so the next reflection loads from the new place
  with no restart. Anything still missing after the move is downloaded. Resolution precedence:
  `WORDS_MODELS_DIR` env var → `settings.modelsDir` (the folder picked in the app) → the built-in default
  above.
- Write-first entry screen: opens straight to a blank page, no dashboard.
- Save on `Ctrl+Enter`. Entries are saved instantly as plain JSON files under your local user data
  folder — nothing is sent anywhere.
- After saving, a soft one-line reflection quietly fades in once the local model responds (this never
  blocks the writing surface — if the model isn't running, the entry still saves fine, just without a line).
  The reflection notices a thought, question, or tension grounded in the entry, leaving its meaning with
  the writer. It avoids judgment, advice, personality labels, and invented motives or past connections.
  Simple entries can receive simple observations; it should not manufacture depth. See
  `REFLECTION_SYSTEM_PROMPT` in `src/main/llamacpp.ts`. Existing reflections stay unchanged unless you use
  **listen again** in the reading view.
- **Resurfacing** uses passage embeddings and dated source links, independently of reflections. Sensitivity is configurable. Matches suggest related ideas; they do not establish that two thoughts or programs are equivalent.
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
- **Handwriting fonts**: each writing mode offers three bundled handwriting fonts (pencil, quill, ink); pick one per
  mode in Settings → Handwriting. An entry keeps the font it was written in.
- **Writing mode**: an actual rotary dial, top-right of the writing surface — drag it around like a watch
  crown (or focus it and use the arrow keys) to turn between three modes — **pencil** (unlimited edits,
  ordinary character-by-character backspace, with Ctrl+Backspace / Alt+Backspace to drop the whole
  previous word), **quill** (a per-entry budget of whole *words* you can correct,
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
  dial on the writing surface, not from here. The fixed model pair is shown below; custom filenames and embedding prefixes remain developer environment overrides.
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

- **Reflection quality varies.** The reading view's "listen again" control regenerates a reflection with the active local model; its output can still be mistaken.
- **Old journal import is `.txt`/`.md` only** — no PDF, no other journaling apps' export formats.
- **Matching needs broader evaluation** — Qwen has been exercised locally on paraphrases and code. Similarity thresholds are starting values, not calibrated probabilities.
- **Code equivalence is not verified** — embeddings can match code with opposite behavior. This feature recalls related writing; it is not a duplicate-code proof or an assessment of originality.
- **The custom write surface has no native spellcheck or conventional cursor editing.** IME composition uses a hidden textarea, but still needs hands-on multilingual testing.
- **The installer is unsigned** — no code-signing certificate, so Windows SmartScreen flags it as an
  unrecognized publisher on first run ("More info" → "Run anyway" gets past it). Fine for testing on your own
  machine; would want fixing before handing this to anyone else.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (already detected on this machine).
- Two local model files in GGUF format. Models run **in-process via [node-llama-cpp](https://node-llama-cpp.withcat.ai/)**
  (llama.cpp bindings) — there's no separate service to install or keep running, unlike Ollama. `npm install`
  pulls a prebuilt native binary automatically, with GPU offload via CUDA or Vulkan auto-detected at
  runtime (whichever is actually available — CUDA needs the CUDA Toolkit installed, not just the driver;
  Vulkan usually works out of the box on a recent GPU driver). Run `npx --no node-llama-cpp inspect gpu` to
  see which backend it'll actually use and how much VRAM it sees.

  **The app downloads selected files itself on first run.** To reuse files or work offline, create a
  `models/` folder at the project root and put the GGUF files in it:

  | File | What to download |
  |---|---|
  | `models/reflection-model.gguf` | e.g. [Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/blob/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf) (~4.9GB, good quality/size balance for an RTX 5070) |
  | `models/Qwen3-Embedding-0.6B-Q8_0.gguf` | [Qwen3 Embedding 0.6B Q8_0](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF) (~639 MB) |

  Rename whatever you download to match those two filenames, or point at different filenames/locations via
  the Settings → Local models folder picker, or via env vars instead of renaming:

  ```
  WORDS_MODELS_DIR=C:\path\to\your\models   # overrides the folder picked in Settings
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
telling apart a model problem from an app problem. It cannot read the app settings, so pass
`WORDS_MODELS_DIR` if your model files live in a folder picked in Settings.

## Building a standalone Windows install

```
npm run dist:win
```

Produces an installer under `dist/` (`Words Setup <version>.exe`, NSIS). It's an **assisted** installer
(`build.nsis` in `package.json`, `oneClick: false`) — the user gets a wizard with a "choose install
location" page (`allowToChangeInstallationDirectory: true`), a per-user install by default that can
elevate to a system location if they pick one (`perMachine: false` + `allowElevation: true`), and
desktop / Start-menu shortcuts. `build.files` is scoped to `out/**/*` + `resources/**/*` specifically —
without that, electron-builder packages the whole project directory by default, which breaks outright the
moment a real GGUF file exists under `models/` (asar has a 4.2GB per-file limit). Model files are never
bundled either way; on first run the app uses files already present or downloads selected missing models.

Built installers are also published to [GitHub Releases](https://github.com/pwnsbd/Words/releases) on this
repo.

## Where your data lives

Entries are stored as one JSON file per entry under Electron's per-user app data folder, e.g.
`%APPDATA%\words\entries\`. Settings (theme, resurfacing sensitivity, the models folder you picked, model choices) live
alongside them in `%APPDATA%\words\settings.json`. Nothing leaves your machine.

## Memory checks

- `npm run test:memory` — deterministic retrieval and migration regression checks.
- `npm run test:memory:model` — adds real inference using the installed Qwen GGUF (CPU).
- `npm run typecheck` and `npm run build` — application checks.
- After building, `electron scripts/smoke-memory.mjs` — isolated hidden Electron save/match/source-link test; fixtures go under `.memory-smoke-*`, never your journal.

## Twenty sample entries

Run `npm run seed:demo` from the project root with both model files present. This explicitly adds 20 backdated entries to the normal Words journal, generates real Llama reflections and Qwen passage embeddings, and writes a sample-only matching report to `docs/demo-results.json`. Sample entries are labeled **sample** in the journal and reading view. Re-running resumes safely without duplicating samples or overwriting unrelated entries. Samples can be deleted through the journal like other entries; they contribute to theme/recap results while present.

The writing is in `sample-entries.json`: four versions each of a journal-memory idea, perfectionism, array deduplication, and protecting a quiet morning hour, plus four unrelated everyday entries. Open a recent sample to follow its earlier matches, or save a new paraphrase of one of those ideas.

Patterns still starts with semantically related passages. A shared reasoning approach across very different subjects may not be retrieved by the embedding stage; recognition is evidence-based and not exhaustive.

`npm run test:philosophy` checks the actual local Llama classifier on a recurring philosophical tension, a shared reasoning approach across different subjects, and a mood-only negative case. It uses synthetic excerpts and an isolated temporary folder, not journal entries.

# Words — Project Overview (for an outside review)

*Written 2026-10-04. Purpose: hand this to a reviewer/agent and ask "what do we still need before a public v0.2.0 release?"*

---

## 1. What Words is

A **private, local-first journaling app for Windows** (Electron). No accounts, no cloud, no telemetry. The writing, the AI models and every insight stay on the user's machine.

**The one job (decided):** *the mirror.* Words remembers what you wrote, so you notice when you're thinking it again. When you save tonight's entry, it quietly shows you the passage from months ago where you said the same thing in different words. Everything else (reflections, patterns, letters) supports or extends that job.

**Who it's for:** someone who journals at night to unload the day and would value seeing their own recurring thoughts, but would never put a journal in the cloud.

**Design philosophy (non-negotiable filter for every feature):**
- Peaceful, not engaging: no streaks, badges, notifications or gamification.
- Patient, not proactive: never pings. When opened, it has something worth saying or says nothing.
- A listener, not a coach or therapist: it acknowledges ("that sounds heavy") and never diagnoses or advises.
- An evening ritual: relief, not evaluation.
- Non-imposing: resurfaced memories feel like glancing at a photo on a shelf.

Original product brief: `words-app-brief.md`. Full feature notes: `README.md`.

## 2. Status at a glance

| Area | State |
|---|---|
| Version | 0.2.0 in package.json, not yet tagged/released |
| Repo | github.com/pwnsbd/Words, branch `main`, local commits not yet pushed |
| Licence | MIT, plus THIRD_PARTY_LICENSES.md (bundled in the installer) |
| Installer | NSIS via electron-builder; assisted wizard; **unsigned** (SmartScreen warning) |
| Models | Downloaded automatically on first run (~5.5 GB total), never bundled |
| Tests | Script-based regression checks (memory, patterns, philosophy), smoke tests in hidden Electron, typecheck. No unit-test framework or CI. |
| Reference release | Sibling project **Rasa** (`Z:/PM Journey/rasa`) shipped v0.1.0 and v0.2.0. Words follows its pattern: licences, release-readiness checklist, fresh-account install test, GitHub Pages showcase with demo video. |

## 3. Architecture

- **Shell:** Electron + electron-vite. React renderer (`src/renderer/src/App.tsx`, ~1,500 lines, one large component file), main process in `src/main/`, preload bridge in `src/preload/`, shared types in `src/shared/`.
- **Inference:** in-process via **node-llama-cpp** (llama.cpp bindings). No Ollama or separate service. GPU offload via CUDA or Vulkan is auto-detected, with CPU fallback (`WORDS_GPU_LAYERS=0`).
- **Fixed model pair:**
  - Reflections, patterns and letters: **Qwen3.5 9B**, Q4_K_M GGUF (~5.7 GB, Apache 2.0; thinking is turned off at the chat wrapper).
  - Memory embeddings: **Qwen3 Embedding 0.6B**, Q8_0 GGUF (~640 MB).
- **Model download:** `src/main/modelDownload.ts` streams from Hugging Face to `.part` files, then renames them into place. It runs in the background on first launch, never blocks writing, and can be retried from Settings. The models folder can be moved in Settings (files are moved, not re-downloaded).
- **Storage:** one JSON file per entry in `%APPDATA%\words\entries\`, plus `settings.json` and `idea-patterns.json` beside them. Models live in `<install dir>\models\` by default. The uninstaller removes the models and *asks* before deleting the journal.
- **Model job queue:** `modelJob()` serialises all model work so reflections, embeddings and patterns never compete for the GPU.

### Save pipeline
1. User writes; Ctrl+Enter saves instantly to JSON.
2. Entry is split into **passages** and embedded (Qwen), then compared with all earlier passages. Up to 3 matches show the older passage, its date and an "open entry" link.
3. In parallel, Qwen writes a one-line soft **reflection** plus a hidden **mood weight** (-2..2). It fades in when ready.
4. Struck-through words (ink mode) are stripped before anything reaches a model.

## 4. Features

### The mirror (core)
- **Passage-level resurfacing.** Overlapping passages are compared, so an idea buried in a long entry can match earlier writing with different wording. All earlier dates are eligible. Sensitivity is configurable in Settings.
- **Model identity on vectors.** Vectors are keyed by model/file/prefix/version, so different embedding models never mix. Old whole-entry vectors migrate automatically, and "Rebuild memory with the active model" re-embeds everything.
- **Patterns** (knotted-thread button above the journal). Recurring *ideas, questions, tensions and ways of reasoning*, not moods. A pattern needs passages from ≥3 entries on ≥3 different days, all mutually similar (loose chains are rejected). Qwen names each pattern; dates, counts and excerpts come from the entries themselves. "These aren't related" dismisses a pattern permanently. Results are cached and recalculated in the background.
- **Recurring themes.** One gentle sentence above the journal list, shown only if a real recurring feeling exists in the last 30 days (needs ≥5 entries).
- **Letters from the past.** On-demand reflective letters for a week, month or year, opened with candle controls that light when opened. Weeks run Sunday to Saturday, and letters can be created for past periods that don't have one yet. Saved letters have list and grid views.

### Writing experience
- Write-first: the app opens on a blank page with no dashboard.
- **Writing dial (featured):** a rotary dial that turns between three modes:
  - **pencil:** free editing.
  - **quill:** a per-entry budget of word corrections (default 5), then the entry locks.
  - **ink:** no deletions; a delete strikes the word through, and the strike is saved and shown when reading back.
- **Entries are permanent:** they can be deleted (two-step) but never edited.
- **Listen again** *(new)*: re-runs the reflection on a saved entry.
- **IME composition** *(new)*: a hidden textarea at the caret feeds the custom surface (IME, emoji panel, dead keys). Not yet checked visually.
- **Spellcheck** *(pending decision)*: Electron's built-in checker can't underline a custom div and needs downloaded dictionaries on Windows. The proposal is nspell plus a bundled English dictionary (~1 MB, offline).

### Look and feel
- Paper-and-ink theme, Lora serif, cream (default) and charcoal themes. Every colour is a CSS variable.
- The journal is a bound-notebook icon with a press-and-spring animation and a page-turn into the journal view.
- Procedural **wax seal** on each entry scroll (SVG turbulence). It's murky and irregular on heavy days, smooth and airy on light ones. A real image-generation model was deliberately set aside.
- Mood dots beside each entry date (no charts, no numbers).

### Other
- Import of old `.txt`/`.md` journals, backdated from the filename date or the file's modified time. Imported entries are embedded but get no reflections.
- Settings: theme, resurfacing sensitivity, quill budget, models folder, About Words.
- `npm run seed:demo` adds 20 labelled sample entries with real model output.

## 5. Release plan in progress (PLAN.md)

| # | Task | State |
|---|---|---|
| T1 | MIT LICENSE + third-party licences, bundled | done |
| T2 | "listen again" (regenerate reflection) | done; README update pending |
| T3 | IME done (unverified visually); spellcheck needs a dependency decision |
| T4 | Evaluate and tune mirror matching thresholds on the 20 samples | next |
| T5 | First-run experience: make the mirror understandable before there are enough entries | pending (copy decision) |
| T6 | README rewrite around the mirror, GitHub Pages showcase, demo video | pending |
| T7 | Release-readiness checklist + fresh-Windows-account install test | pending |
| T8 | Tag v0.2.0, GitHub Release with installer | pending |

**Explicitly out of scope for this release:** generated wax-seal images, PDF and other-app import, code signing, cross-device sync, mobile.

## 6. Known risks and gaps

1. **Matching quality is uncalibrated.** Similarity thresholds are starting values, tested only on local paraphrases. This is the biggest risk to the one job.
2. **Cold start.** The mirror shows nothing until several entries exist, so a new user may not see the point in week one.
3. **Hardware floor.** The 9B reflection model wants a GPU with ~6 GB+ VRAM for good speed. CPU works but is slow. There is no smaller-model fallback in the UI (the model pair is fixed), and no documented minimum spec yet.
4. **5.5 GB first-run download** with no up-front size or disk-space warning (Rasa added a free-space preflight).
5. **Unsigned installer.** Windows SmartScreen will warn every new user.
6. **No auto-update.** Unverified whether electron-builder publishes `latest.yml`; there is no update check in the app.
7. **Scale.** Patterns uses an in-memory scan, and large journals (years of entries) are untested for speed.
8. **Data safety.** Entries are plain JSON with no encryption at rest, no backup/export feature, and no corruption recovery beyond the files themselves.
9. **Licence obligations.** Qwen3.5 and Qwen3 Embedding are Apache 2.0, so no attribution banner is needed. Model and font licence text was written from memory and needs checking against the source.
10. **Testing.** No CI and no unit-test framework; the custom editor (writing modes, IME, spellcheck) has no automated tests.
11. **Accessibility.** The custom editor and dial need a screen-reader and keyboard-only review (role=textbox on a div).
12. **Windows only.** No macOS or Linux build.

## 7. Questions for the reviewer

1. For a public v0.2.0 of a privacy-first journal, which of the risks in §6 are **release blockers** and which can wait for 0.3?
2. How should the mirror's matching quality be **measured** before release? What evaluation set, and what counts as good enough?
3. What's the best **cold-start** experience that stays "patient, not proactive"?
4. Should there be a **smaller-model / CPU-only option** (e.g. a 3B model) so people without a GPU aren't excluded, given the one-job focus?
5. Does a journal app need **encryption at rest and an export/backup** before strangers trust it with their journal?
6. What should the **showcase page and demo video** show to communicate the mirror in under 30 seconds?
7. Anything missing for a credible open-source release: a privacy statement, a contributing guide, issue templates, a minimum-spec section, a changelog?
8. Is anything in the feature set **diluting** the one job and better hidden or cut for this release?

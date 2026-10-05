# Contract — Handwriting fonts per writing mode

**Goal:** writing should feel like handwriting, not typing on a computer. Each writing mode (pencil, quill, ink) offers 3 bundled handwriting fonts. Settings chooses one per mode, and every saved entry keeps the font it was written in.

## Fonts (decided with the user, 2026-10-05; the first in each row is the default)
| Mode | Font id | Family | Starting size scale |
|---|---|---|---|
| pencil | `caveat` | Caveat 400 | 1.25 |
| pencil | `gochi-hand` | Gochi Hand 400 | 1.1 |
| pencil | `indie-flower` | Indie Flower 400 | 1.1 |
| quill | `dancing-script` | Dancing Script 400 | 1.2 |
| quill | `cormorant-italic` | Cormorant Garamond Italic 400 | 1.15 |
| quill | `parisienne` | Parisienne 400 | 1.3 |
| ink | `kalam` | Kalam 400 | 1.0 |
| ink | `special-elite` | Special Elite 400 | 0.95 |
| ink | `courier-prime` | Courier Prime 400 | 0.95 |

The size scale multiplies the writing surface's current font-size so all nine fonts read at a similar visual size. These values are a starting point; the Conductor tunes them with the user afterwards. Keep them in one table in code.

## Inputs and outputs
- **Font files:** latin-subset `.woff2`, self-hosted in `src/renderer/src/assets/fonts/` with `@font-face` in `styles.css`, the same way Lora is loaded. No runtime network calls. Get them from the `@fontsource/<name>` npm packages via `npm pack` into a temp folder, and copy only the woff2 files. Don't add a dependency. All nine are SIL OFL 1.1; add each one to `THIRD_PARTY_LICENSES.md`.
- **Shared types** (`src/shared/types.ts`):
  - `HandwritingFont` is the union of the 9 ids.
  - `Settings.handwriting: Record<WritingMode, HandwritingFont>`, default `{ pencil: 'caveat', quill: 'dancing-script', ink: 'kalam' }`.
  - `JournalEntry.font?: HandwritingFont`.
  - A single shared table maps each id to `{ mode, family, scale, label }`.
- **Settings** (`src/main/settings.ts`): `validatedPatch` accepts a partial `handwriting` object. Each id must exist and belong to that mode, otherwise it throws `Invalid handwriting font`. Saved settings that lack `handwriting` merge with the default.
- **Save:** `entries:save` takes `(text, font?)`, and `saveEntry` stores `font` on the entry when it's a valid id; an invalid font is dropped. Imports and samples get no font.
- **Renderer:**
  - The writing surface uses the font of the current mode, `settings.handwriting[mode]`. It switches live when the dial turns.
  - Save passes the font that was active at save time.
  - The reading view of an entry renders its full text in `entry.font`. Entries with no font (old entries, imports, samples) stay in Lora, exactly as today.
  - Struck text, the caret, the IME and spellcheck all keep working in every font.
- **Settings UI:** a "Handwriting" section with one row per mode (pencil, quill, ink) and 3 choices per row. Each choice's label is shown in its own font. Match the existing segmented controls in Settings (look at how `resurfaceSensitivity` or `theme` is drawn) in both themes. Choosing a font saves immediately, like the other settings.

## Errors
- If a font file fails to load, fall back through the `font-family` stack to `var(--serif)` (Lora). Never a blank or invisible page.
- An unknown font id on an entry renders in Lora.

## Performance
Fonts load with `font-display: swap`. Switching the dial causes no visible layout jump beyond the font change itself.

## Out of scope
Journal list and grid cards, letters, patterns and the rest of the UI chrome stay in Lora. Also out of scope: per-entry font switching after save, custom user fonts, font-size settings and line-height redesign.

## Done-check
- `npm run typecheck`, `npm run build` and `npm run test:release` pass.
- A test script (new `scripts/test-handwriting.mjs`, plus an `npm run test:handwriting` entry) covers:
  - the default settings include `handwriting`;
  - the validator rejects an id from another mode (for example `pencil: 'kalam'`) and unknown ids;
  - `saveEntry(text, 'parisienne')` round-trips `font`;
  - an invalid font is dropped.
- Nine woff2 files are present and referenced in `styles.css`, and nine rows are added to `THIRD_PARTY_LICENSES.md`.

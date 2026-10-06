# Words — PLAN

**Goal:** Release Words v0.2.0 on GitHub (Rasa pattern) as a living journal that helps you reflect and notice the patterns in your thinking — private, all models local.

## Decisions (2026-10-04)
- Release copy = the user's own description (README top, approved 2026-10-05): reflect, notice recurring thoughts (similar thoughts + Patterns), everything local, the experiment's "why". No "mirror" label.
- Licence: **MIT**.
- In scope: regenerate reflection, spellcheck + IME on the write surface, **writing dial stays and is featured**.
- Out of scope for this release: wax-seal image generation, PDF/other-app import.
- Installer ships unsigned (as Rasa did); flagged in release notes.
- Base commit for all tasks: `53f7ebe` on `main`.

## Tasks
| # | Task | Owner | Files | Done when | Status |
|---|---|---|---|---|---|
| T1 | MIT LICENSE + THIRD_PARTY_LICENSES.md, bundled via extraResources | builder | LICENSE, THIRD_PARTY_LICENSES.md, package.json (build only) | `npm run build` ok; both files listed in build.extraResources | done b33f5fb |
| T2 | Regenerate reflection on a saved entry | builder | see docs/contracts/reflection.md | contract done-check | done 084b261 (README pending) |
| T3 | Spellcheck + IME composition on write surface | builder | see docs/contracts/write-surface.md | contract done-check | done ce9290a + 5a92738 + b55576f (release smoke passes) |
| T4 | Mirror quality: evaluate + tune thresholds on 20 samples | builder (main checkout, needs models) | src/main/memory.ts, similarityIndex.ts, docs/memory-models.md | report of hits/misses before/after | done 90b4690 (rare 0.74, balanced 0.68, often 0.61) |
| T4b | Letters: finished-period rules (week 2; month every-week or 5; year 12 or 6 months), "from N entries", feather "write again" | builder | docs/contracts/letters.md | test:letters | done 8af8ec8 |
| T4c | UI polish: delete icon + top-right actions (7c003a2), Patterns rope + knots (d2c27c2), ink scrollbar (29eb578) | builder | renderer | user visual check | merged, visual check pending |
| T5 | First-run: mirror visible early (empty-state copy) | Conductor + user (taste) | App.tsx | user approves | done ae8c8ef |
| T6 | README rewrite (intro from user's description) + GH Pages showcase + demo | Conductor drafts, builder builds | README.md, docs/index.html | user approves | intro done; showcase + demo pending |
| T7 | docs/release-readiness.md + fresh-account install test | Conductor + user | docs/ | install test passes | last |
| T8 | Tag v0.2.0, GitHub Release with installer | user confirms | — | release live | last |
| T9 | Handwriting fonts: 3 per writing mode, chosen in Settings, stored per entry | builder | see docs/contracts/handwriting.md | contract done-check + user visual check | merged, size tuning pending |
| T10 | Reflection model → Qwen3.5-9B: side-by-side eval (A), swap after user approves (B) | builder | see docs/contracts/reflection-model.md | contract done-check + user picks | done 555cddc, ac6f625, 04e979d, 40a4fb7 (user chose Qwen) |
| T11 | Demo journal: 20 entries in demo-entries.json (philosophy, happy, release excitement, doubt), seeded via seed:demo | Conductor writes, builder adapts seed script | demo-entries.json, scripts/seed-demo.ts | user approves text; app shows the 4 patterns + letters | seeded 2026-10-06; user visual check of patterns + letters pending |
| T12 | Showcase media: one scripted run (write "It has been a great day!" → save → journal → other pages) recorded as video, with 6 screenshots taken during it + README GIF; isolated demo profile | builder | see docs/contracts/showcase-media.md | contract done-check + user visual check | dispatched 2026-10-06 |
| T13 | GitHub Pages showcase (docs/index.html): user's intro text, screenshots, video playing inline, download link | Conductor drafts, builder builds | see docs/contracts/pages-site.md | contract done-check + user visual check | dispatched 2026-10-06 (media lands with T12) |

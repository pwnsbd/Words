# Words — PLAN

**Goal:** Release Words v0.2.0 on GitHub (Rasa pattern) as *the mirror*: a private journal that remembers what you wrote, so you notice when you're thinking it again.

## Decisions (2026-10-04)
- One job = **the mirror** (resurfacing similar past passages). Release copy leads with it.
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
| T4 | Mirror quality: evaluate + tune thresholds on 20 samples | builder (main checkout, needs models) | src/main/memory.ts, similarityIndex.ts, docs/memory-models.md | report of hits/misses before/after | after T2/T3 |
| T5 | First-run: mirror visible early (empty-state copy) | Conductor + user (taste) | App.tsx | user approves | done ae8c8ef |
| T6 | README rewrite around the mirror + GH Pages showcase + demo | Conductor drafts, builder builds | README.md, docs/index.html | user approves | after T5 |
| T7 | docs/release-readiness.md + fresh-account install test | Conductor + user | docs/ | install test passes | last |
| T8 | Tag v0.2.0, GitHub Release with installer | user confirms | — | release live | last |

## Cleanup left for the user
- Delete stray `--help` (SQLite file), `.memory-smoke-*` dirs and `*.log` at repo root (now git-ignored).

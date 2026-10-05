# CLAUDE.md

<!-- lingo:start -->
## Lingo — keep the project dictionary current

This project uses **Lingo**: a shared record of every named thing, exposed
through the `lingo` MCP server. The developer reads these names from the Lingo
sidebar and will refer to them — so keep the record accurate.

**Call `log_element` whenever you create, rename, restyle, or meaningfully
change a named part of the app — windows, views, menus and commands, keyboard shortcuts, IPC channels, tray items, preferences** — as part of that same change, not batched later.
Re-logging something that already exists just updates its row, so log freely.
Pass:

- `area` — the window it belongs to (e.g. Main, Preferences, Onboarding, Tray)
- `name` — what you call it in the code
- `file` — workspace-relative path to the file that defines it
- `description` — one plain-English sentence
- `kind` (optional) — window | view | panel | menu | menu-item | command | action | shortcut | ipc-channel | tray-item | protocol | pref | dialog | notification | other
- `parent` (optional) — the name of a containing element in the same area
- `codeId` (optional) — the exact code identifier (export name, DOM id, selector)
- `previousName` — only on a rename

**Especially log these — they're the ones people forget:**

- IPC channel names and which side sends / handles
- Window names and each window's role
- Menu command IDs and their keyboard accelerators
- Tray actions
- Preference / setting keys
- Protocol / deep-link schemes the app registers

**Before changing something that already exists**, call `list_elements`
(optionally filtered by `area`) or `get_element` to recall the exact name.

Lingo never scans or edits code — it only records what you tell it.
<!-- lingo:end -->

## Agent notes
- 2026-10-04 — worktree agents start at origin/main (04965d5), not local main → every brief names the base commit and tells the agent to reset/rebase onto it first; merge by cherry-pick.
- Real models live in models/ (git-ignored), so model-dependent tasks (memory threshold tuning, smoke tests) run in the main checkout, not a worktree.
- 2026-10-04 — the user's own agent was editing the main checkout while builders finished, so a cherry-pick was blocked → run `git status --short` before every merge; if there are foreign edits, hold the merge and ask.

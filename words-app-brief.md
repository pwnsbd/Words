# Words — Product Brief

**A local-first journaling companion that listens, never judges, and quietly gets to know you over time.**

---

## 1. Core Concept

Words is a private, local-first journaling app. There are no accounts, no cloud sync, no one watching. Everything — the writing, the models, the insights — lives on the user's own machine.

The core idea: as someone journals over months and years, Words quietly builds a private map of their own mind. It doesn't just store entries — it notices patterns across them (recurring themes, emotional tone, resurfacing memories) and reflects them back gently, the way someone who has read your journal for years might.

**The differentiator isn't local vs. cloud plumbing — it's the mirror.** Most journaling/writing apps (Notion AI, etc.) offer a generic assistant bolted onto a doc. Words is meant to feel like it gets to know *you*, specifically, better as you go.

## 2. Emotional / Design Philosophy — read this before building anything

This is the most important section. Every feature decision should be filtered through it.

- **Peaceful, not engaging.** No streaks, no gamification, no red badges, nothing that creates an addictive "open the app" itch.
- **Patient, not proactive.** The app never pings, nags, or notifies. It waits. When the user opens it, it should have something quietly worth saying — never filler.
- **A listener, not a coach or therapist.** It never analyzes, advises, or diagnoses. Think: a mother listening to a child, offering a few soft words of encouragement — not "have you considered..." Reflections should acknowledge ("that sounds heavy," "sounds like today had some light in it too"), never interpret or instruct.
- **An evening ritual.** Picture someone tired, at night, sitting down to pour out their day. The app is a place of relief, not evaluation.
- **Non-imposing.** Resurfaced memories and pattern insights should feel like glancing at a photo on a shelf — not a push notification demanding attention.

## 3. Core Features

1. **Write-first entry.** Opening the app drops the user straight into a blank page — no dashboard, no nav clutter first.
2. **Soft mood reflection.** After saving an entry, a small, gentle one-line remark on emotional tone (e.g., "sounds like today had some light in it too"). Never clinical, never advice.
3. **Semantic similarity / resurfacing.** Entries are embedded and compared over time so old, thematically related entries can quietly resurface (e.g., "you wrote something like this a year ago").
4. **Recurring theme tracking.** Gently surfaces patterns across time ("you've mentioned feeling stuck a lot lately") — delivered softly, like a passing observation, never a report.
5. **Mood trends over time.** A simple visual thread of emotional tone across weeks/months.
6. **Monthly/seasonal recap.** A short reflective summary of recent writing — like a letter from a past self.
7. **Wax-seal entry stamps.** Each entry generates a small abstract image (via local image generation) reflecting its emotional texture — jumbled/murky for heavy days, open/airy for light days. Over time these form a wordless visual timeline, like a trail of pressed wax seals.
8. **Old journal import.** Users can bulk-import old journal entries; each gets embedded and back-dated so the system has years of material from day one.

## 4. UI / Interaction Model

- **Front door:** a single, minimal writing surface — cream/warm or muted charcoal background, serif typeface for warmth, generous margins so text can "breathe." Avoid stark white minimalism (reads cold) and avoid techy/gamified aesthetics.
- **Page-flip reveal:** a literal page-turning gesture/animation reveals the deeper layer — wax seal timeline, mood trends, resurfaced memories, semantic connections — reinforcing the "journal as physical object" feeling rather than a screen switch.
- Nothing on the writing surface should compete with the act of writing itself.

## 5. Technical Architecture

### Model stack (kept intentionally small — three models, not one growing model)
The models themselves are **static** — they don't retrain or grow. What grows is the user's personal data layer (entries + embeddings) that gets fed to them as context.

| Purpose | Model type | Notes |
|---|---|---|
| Semantic similarity / search | Small local embedding model (e.g. sentence-transformers class) | Tens of MB, sub-second per entry, CPU is fine |
| Mood reflection + theme/recap generation | Local generative LLM | Tiny (Phi-class) runs fine on CPU but reflections read generic; an 8B-class local model (Llama/Mistral variant) on GPU gives noticeably more thoughtful, human-sounding reflections — recommended given the RTX 5070 |
| Wax-seal image generation | Small local image generation model (e.g. lightweight Stable Diffusion variant) | Prompted from the mood/theme reading of the entry |

### Pipeline
1. User writes and saves an entry (trigger: on save, not on keystroke — avoids false matches on half-formed thoughts and keeps writing distraction-free).
2. Entry is embedded → compared against existing entries for similarity/resurfacing candidates.
3. Entry + context passed to local LLM → one-line soft reflection generated.
4. Mood/theme reading passed to local image model → wax-seal stamp generated.
5. Entry, embedding, reflection, and stamp stored locally.

### Distribution question (resolved)
Two architectures were discussed:
- **(A) Public web app + local companion app**, where the browser talks to a background process on `localhost` (the Ollama/Docker Desktop pattern). Free to implement (no certificate purchase needed — options include CORS allowlisting for localhost from an HTTPS origin, or `mkcert` for a free locally-trusted cert), but adds real complexity: two codebases, a browser-to-localhost handshake, and the user has to install something anyway.
- **(B) Native local Windows app.** Recommended direction — since users install something either way, this skips the bridge problem entirely.

**Decision: lean toward (B), a local Windows app**, unless cross-device sync or try-before-install turns out to matter a lot.

## 6. Open Questions for Next Pass

- Exact local LLM choice/size (Phi-class vs. 8B Llama/Mistral) — quality vs. resource tradeoff to finalize.
- Exact embedding model and vector storage approach (e.g. local SQLite + vector extension, or a lightweight local vector DB).
- Image generation model choice for the wax seals, and how literally/abstractly the mood-to-image mapping should be prompted.
- Whether recap/theme surfacing happens on a fixed cadence (e.g. monthly) or opportunistically when the user opens the app.
- Old-journal import format support (plain text, PDF, existing journaling app exports, etc.).

---

*This is a conversational brief capturing the concept, philosophy, features, and architecture as discussed. Hand to a coding agent as a starting point — the open questions above are worth resolving (or at least making a deliberate v1 call on) before implementation begins.*

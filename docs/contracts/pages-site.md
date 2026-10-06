# Contract: GitHub Pages showcase site (T13)

**Why:** one page that shows a stranger what Words is, lets them see it working, and gets them to the download. It is served by GitHub Pages from `/docs` on `main`.

**Inputs:**
- Copy: [README.md](../../README.md) is the source of truth. The "What Words is" intro and "Why I made this" go in **word for word**; they are the user's own voice, so don't edit them. Shorter feature lines may be taken from "What it does", lightly trimmed only.
- Media from T12, in `docs/media/`: `write.png`, `saved.png`, `journal.png`, `entry.png`, `patterns.png`, `letter.png`, `showcase.mp4` (1440×900). They may not exist yet when you build, so reference these paths anyway.
- Icon: `resources/icon.svg`.
- Palette and type from the app (`src/renderer/src/styles.css`):
  - Cream: paper `#f4ecdc`, paper-dim `#ece2cd`, ink `#3a332c`, ink-soft `#6b6154`, ink-faint `#a89d8a`, parchment `#efe4cc`/`#e6d8b2`, seal `#5b2a24`/`#c97a3d`.
  - Charcoal: paper `#2a2723`, paper-dim `#35312a`, ink `#e9e2d3`, ink-soft `#b6ab95`, ink-faint `#7d7362`, seal-light `#d98f52`.
  - Fonts: Lora for body and headings, Caveat for small handwritten accents only (both from Google Fonts).

**Outputs:**
- `docs/index.html`: a single file with inline CSS. No framework, no build step, no analytics, no cookies, no external JS.
- `docs/.nojekyll` (empty).
- `docs/icon.svg`, copied from resources.

**Page, top to bottom:**
1. **Hero:**
   - the icon and "Words";
   - the line "A living journal that helps you reflect on your thoughts and see the patterns in your thinking.";
   - a **Download for Windows** button → `https://github.com/pwnsbd/Words/releases/latest`;
   - one quiet line under it: "Free and open source · Windows · everything runs on your computer".
   - Then the video: `<video controls playsinline preload="metadata" poster="media/write.png">` with the MP4, rounded corners and a soft paper shadow. No autoplay with sound.
2. **What Words is:** the README intro, word for word.
3. **What it does:** alternating rows (screenshot left / text right, then swapped), each a short heading plus 1–2 sentences:
   - "You just write" → write.png
   - "It reflects back, gently" → saved.png
   - "It remembers" → journal.png
   - "It finds your patterns" → patterns.png
   - "It writes you letters" → letter.png
   - "Entries stay as you wrote them" → entry.png

   Images get real `alt` text, `loading="lazy"`, and `width`/`height` set to avoid layout shift.
4. **Your writing stays yours:** the README bullets.
5. **Why I made this:** the README section, word for word. Set it a little more intimately (narrower column, slightly larger type), as a personal note, maybe signed in Caveat ("— Pawan").
6. **Install:** the 3 README steps, including the unsigned-installer note and the GPU line.
7. **Footer:** a GitHub repo link (`https://github.com/pwnsbd/Words`), "MIT licence", and nothing else.

**Feel:** quiet, paper-and-ink, unhurried, like the app. Use lots of whitespace, a ~720 px text column, and media up to ~1100 px. Use subtle paper colour, not loud gradients. No stock icons, emoji or marketing badges. The cream palette is the default, with the charcoal palette under `prefers-color-scheme: dark`. Define colours as CSS variables on `:root`.

**Errors / edge cases:**
- If an image or the video is missing, the layout must not collapse: alt text shows inside a reserved aspect-ratio box.
- It works at 375 px wide: rows stack, there's no horizontal scroll, and side padding is 16 px.

**Perf budget:** HTML+CSS under 30 KB; the fonts are the only external requests.

**Out of scope:** enabling Pages in the repo settings (the user does that), the media files themselves (T12), README changes, and a multi-page site.

**Done-check:**
- `docs/index.html` opens from disk with no console errors.
- At 1440 px and 375 px there's no horizontal scroll, and missing media show reserved boxes.
- The intro and "Why I made this" text matches README.md exactly. Check with a script that extracts both sections and diffs them.
- Then the user does a visual check.

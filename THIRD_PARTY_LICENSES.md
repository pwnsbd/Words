# Third-party software, models and fonts

Words' own source code is MIT-licensed (see [LICENSE](LICENSE)). It depends on
the open-source packages below, downloads two machine learning models at
runtime, and bundles one font. Licenses were read from each package's
`package.json` / the official model card as of 2026-10. If a dependency,
model or font is swapped or upgraded, re-check its license before shipping.

## Runtime npm dependencies

| Package | Version | License |
|---|---|---|
| `@electron-toolkit/preload` | 3.0.2 | MIT |
| `@electron-toolkit/utils` | 3.0.0 | MIT |
| `dictionary-en` | 4.0.0 | MIT AND BSD (SCOWL / Ispell en_US Hunspell dictionary) |
| `node-llama-cpp` | 3.20.0 | MIT |
| `nspell` | 2.1.5 | MIT |

`node-llama-cpp` is the Node binding Words uses to run models locally
(`src/main/llamacpp.ts`). Its prebuilt platform packages
(`@node-llama-cpp/win-x64`, etc., 3.20.0, MIT) ship compiled
[llama.cpp](https://github.com/ggml-org/llama.cpp) / ggml binaries, which are
MIT-licensed (Copyright the ggml authors).

Transitive dependencies of these packages, and the dev/build tooling (Electron,
React, Vite, electron-builder, ...), are not enumerated here. Electron itself
is MIT and bundles Chromium under its own notices (shipped with the app as
`LICENSES.chromium.html`).

## Models (downloaded at runtime, not redistributed in the installer)

| Model | Used for | License | Source |
|---|---|---|---|
| Qwen3.5 9B (GGUF Q4_K_M quant by `unsloth`) | Reflections, letters, patterns | Apache-2.0 | [Model card](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF) |
| Qwen3 Embedding 0.6B (GGUF, Q8_0) | Memory / semantic search embeddings | Apache-2.0 | [Model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF) |

### Qwen3.5 9B

Apache-2.0, Copyright Alibaba Cloud / Qwen team. License text:
https://www.apache.org/licenses/LICENSE-2.0

Words no longer uses Meta Llama 3.1, so the Llama 3.1 Community License
obligations (including "Built with Llama" attribution) no longer apply to the
default configuration. If the old `reflection-model.gguf` is kept and selected
with `WORDS_REFLECTION_MODEL_FILE`, that file remains under its own license.

### Qwen3 Embedding 0.6B

Apache-2.0, Copyright Alibaba Cloud / Qwen team. License text:
https://www.apache.org/licenses/LICENSE-2.0

## Fonts

| Font | Files | License |
|---|---|---|
| Lora (Cyreal) | `src/renderer/src/assets/fonts/Lora-Regular.woff2`, `Lora-Italic.woff2` | SIL Open Font License 1.1 |
| Caveat | `src/renderer/src/assets/fonts/caveat-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| Gochi Hand | `src/renderer/src/assets/fonts/gochi-hand-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| Indie Flower | `src/renderer/src/assets/fonts/indie-flower-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| Dancing Script | `src/renderer/src/assets/fonts/dancing-script-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| Cormorant Garamond Italic | `src/renderer/src/assets/fonts/cormorant-garamond-latin-400-italic.woff2` | SIL Open Font License 1.1 |
| Parisienne | `src/renderer/src/assets/fonts/parisienne-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| Kalam | `src/renderer/src/assets/fonts/kalam-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| Special Elite | `src/renderer/src/assets/fonts/special-elite-latin-400-normal.woff2` | Apache License 2.0 (per @fontsource metadata) |
| Courier Prime | `src/renderer/src/assets/fonts/courier-prime-latin-400-normal.woff2` | SIL Open Font License 1.1 |

Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic).
The OFL 1.1 text is at https://openfontlicense.org. The font is self-hosted
and bundled unmodified in the app.

## Not legal advice

This document is a good-faith summary compiled from published licenses, not a
legal opinion. Get a license review before a real commercial release.

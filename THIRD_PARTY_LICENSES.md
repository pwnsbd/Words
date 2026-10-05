# Third-party software, models and fonts

Words' own source code is MIT-licensed (see [LICENSE](LICENSE)). It depends on
the open-source packages below, downloads two machine learning models at
runtime, and bundles one font. Licenses were read from each package's
`package.json` / the official model card as of 2026-10. If a dependency,
model or font is swapped or upgraded, re-check its license before shipping.

**Built with Llama.**

## Runtime npm dependencies

| Package | Version | License |
|---|---|---|
| `@electron-toolkit/preload` | 3.0.2 | MIT |
| `@electron-toolkit/utils` | 3.0.0 | MIT |
| `node-llama-cpp` | 3.20.0 | MIT |

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
| Meta Llama 3.1 8B Instruct (GGUF quant by `bartowski`) | Reflections, letters, patterns | Llama 3.1 Community License | [Model card](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF) |
| Qwen3 Embedding 0.6B (GGUF, Q8_0) | Memory / semantic search embeddings | Apache-2.0 | [Model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF) |

### Llama 3.1 Community License

Llama 3.1 is licensed under the Llama 3.1 Community License, Copyright (c)
Meta Platforms, Inc. All Rights Reserved. Full text:
https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/LICENSE

Key obligations that apply to Words:

- **Attribution:** "Built with Llama" must be displayed prominently on a
  related website, user interface, blogpost, about page or product
  documentation when a product uses Llama materials. Words complies by stating
  it in this file; keep it visible in the app's about/README as well.
- Any copy of the model that is redistributed must include the license
  agreement and the notice "Llama 3.1 is licensed under the Llama 3.1
  Community License, Copyright (c) Meta Platforms, Inc. All Rights Reserved."
- Use is subject to Meta's Acceptable Use Policy:
  https://llama.com/llama3_1/use-policy
- Products with more than 700 million monthly active users require a separate
  license from Meta.
- Outputs of Llama may not be used to improve another LLM (other than Llama
  and its derivatives).

### Qwen3 Embedding 0.6B

Apache-2.0, Copyright Alibaba Cloud / Qwen team. License text:
https://www.apache.org/licenses/LICENSE-2.0

## Fonts

| Font | Files | License |
|---|---|---|
| Lora (Cyreal) | `src/renderer/src/assets/fonts/Lora-Regular.woff2`, `Lora-Italic.woff2` | SIL Open Font License 1.1 |

Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic).
The OFL 1.1 text is at https://openfontlicense.org. The font is self-hosted
and bundled unmodified in the app.

## Not legal advice

This document is a good-faith summary compiled from published licenses, not a
legal opinion. Get a license review before a real commercial release.

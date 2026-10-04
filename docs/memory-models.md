# Basic model configuration

Words uses one fixed pair:

- **Reflection:** existing Meta Llama 3.1 8B Instruct Q4_K_M, `reflection-model.gguf` (4,920,739,232 bytes locally).
- **Memory:** Qwen3 Embedding 0.6B Q8_0, `Qwen3-Embedding-0.6B-Q8_0.gguf` (639,150,592 bytes locally).

The small reflection, reflection-off, and Nomic options have been removed. Previously saved model preferences normalize to this pair. No old model files are deleted. Custom filenames and prefixes remain developer environment overrides; the normal app configuration needs no choices.

## Retrieval

Qwen compares unprefixed text for symmetric passage similarity. Clean writing is split into overlapping windows of at most 900 characters with 120 characters of overlap. The strongest matching passage per older entry is returned, up to three entries, with a dated source link. The index uses model/file/prefix/version identity to avoid mixing embeddings from different models. Legacy entries rebuild lazily; Settings can rebuild all memory explicitly.

Reflection context is capped at 4,096 tokens; embedding context at 2,048. Inference is local. Saves persist immediately, with queued memory and reflection work in the background. Initial indexing of a long journal may take time.

## Qwen verification

`npm run test:memory:model` ran against the actual Qwen GGUF on CPU:

| Pair | Cosine score | Balanced result |
|---|---:|---|
| Fear of imperfection / avoiding starting projects | 0.784 | Surfaces |
| Journal remembering older ideas / notebook recognizing reworded thoughts | 0.774 | Surfaces |
| `[...new Set(items)]` / `Array.from(new Set(values))` | 0.750 | Surfaces |
| Journal memory idea / roasting potatoes | 0.231 | Quiet |
| Ascending sort / descending sort | 0.913 | Surfaces as related |

Thresholds remain 0.80 / 0.68 / 0.64 for rarely / sometimes / often. This small test set is not a representative benchmark. In particular, high similarity does not establish equivalent program behavior or prove that an idea is unoriginal. Qwen emits a control-token metadata warning, but inference completes and the retrieval assertions pass.

Regression checks cover vector validation, model identity isolation, chronology, deleted entries, passage offsets, migration, reuse, model swaps, missing models, and queue recovery.

## Samples

`npm run seed:demo` creates 20 clearly marked, backdated samples in the normal local journal, with real reflections and embeddings. IDs are deterministic; rerunning resumes incomplete work and does not duplicate existing samples. The script refuses to overwrite an unexpected entry occupying a sample ID. The sample-only report is `docs/demo-results.json`.

Four recurring subjects appear in four different phrasings across dates: remembering earlier ideas, perfectionism, array deduplication, and focused mornings. Four other entries provide unrelated everyday subjects. Samples are included in themes and recaps while present and can be deleted individually in the app.

Model source: [Qwen3 Embedding GGUF](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF).

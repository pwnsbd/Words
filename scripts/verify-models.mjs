// Faithfully reproduces what src/main/llamacpp.ts does on a real save: both
// models loaded lazily and concurrently the first time, exactly like
// index.ts's Promise.all([reflectOn(text), embed(text)]). Written as a
// standalone script (not importing llamacpp.ts directly) because that file
// imports @electron-toolkit/utils, which touches `electron.app` at module
// load time and crashes outside a real Electron process.
import { getLlama, LlamaChatSession, resolveChatWrapper } from 'node-llama-cpp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Mirrors llamacpp.ts: WORDS_MODELS_DIR wins, else models/ at the project
// root. (This standalone script can't read the app's settings.json, so a
// folder picked in-app has to be passed here via the env var.)
const modelsDir = process.env.WORDS_MODELS_DIR || join(__dirname, '..', 'models')
const reflectionModelPath = join(modelsDir, process.env.WORDS_REFLECTION_MODEL_FILE || 'Qwen3.5-9B-Q4_K_M.gguf')
const embeddingModelPath = join(modelsDir, 'Qwen3-Embedding-0.6B-Q8_0.gguf')

const REFLECTION_SYSTEM_PROMPT = `You are a quiet, gentle presence reading someone's private journal entry at the
end of their day. Respond with exactly one short sentence acknowledging the emotional tone of what they wrote —
the way someone who loves them might, after listening closely. Never analyze, advise, diagnose, or ask a question.
Never say "it sounds like you should..." or offer suggestions. Just acknowledge, warmly and briefly, in plain
language. Do not repeat their words back verbatim. One sentence only. No quotation marks, no preamble.`

let reflectionContext
async function reflectOn(llama, text) {
  if (!reflectionContext) {
    const model = await llama.loadModel({ modelPath: reflectionModelPath })
    reflectionContext = await model.createContext()
  }
  const sequence = reflectionContext.getSequence()
  try {
    const session = new LlamaChatSession({ contextSequence: sequence, chatWrapper: resolveChatWrapper(reflectionContext.model, { customWrapperSettings: { qwen: { thoughts: 'discourage' } } }), systemPrompt: REFLECTION_SYSTEM_PROMPT })
    const response = await session.prompt(text, { maxTokens: 80 })
    return response.trim() || null
  } finally {
    await sequence.dispose() // awaited, same as production code
  }
}

let embeddingContext
async function embed(llama, text) {
  if (!embeddingContext) {
    const model = await llama.loadModel({ modelPath: embeddingModelPath })
    embeddingContext = await model.createEmbeddingContext()
  }
  const embedding = await embeddingContext.getEmbeddingFor(text)
  return Array.from(embedding.vector)
}

async function main() {
  const llama = await getLlama()
  const entryText = `Long day. Spent most of it in back-to-back meetings that could have been emails. Made
dinner anyway, sat with it in the quiet for a while.`

  console.log('Simulating first save: reflectOn + embed running concurrently...')
  const t0 = Date.now()
  const [reflection, embedding] = await Promise.all([reflectOn(llama, entryText), embed(llama, entryText)])
  console.log(`  both settled in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log('Reflection:', reflection)
  console.log('Embedding vector length:', embedding?.length)

  console.log()
  console.log('Simulating a second save (models already warm, no reload)...')
  const t1 = Date.now()
  const [reflection2, embedding2] = await Promise.all([
    reflectOn(llama, 'A quieter day today. Nothing much happened, and that was alright.'),
    embed(llama, 'A quieter day today. Nothing much happened, and that was alright.')
  ])
  console.log(`  both settled in ${((Date.now() - t1) / 1000).toFixed(1)}s`)
  console.log('Reflection 2:', reflection2)
  console.log('Embedding 2 vector length:', embedding2?.length)

  console.log()
  console.log('✓ concurrent first-save path works end to end')
  process.exit(0)
}

main().catch((err) => {
  console.error('✗ FAILED:', err)
  process.exit(1)
})

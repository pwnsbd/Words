// Runs the local models directly in-process via llama.cpp (through
// node-llama-cpp) instead of going through a separate Ollama service. This
// trades Ollama's convenience for direct control: exact GGUF file/quant,
// context size, sampling, and GPU offload are all set here, and there's no
// background service to install or keep running — the model is loaded
// straight into this process.
//
// Both models are loaded lazily on first use and kept warm for the life of
// the app. If a model file isn't present, calls fail silently — the entry
// still saves, it just doesn't get a reflection/embedding this time.
//
// node-llama-cpp can only be used from Electron's main process (never the
// renderer) — this module must only ever be imported from src/main.

import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  getLlama,
  LlamaChatSession,
  type Llama,
  type LlamaContext,
  type LlamaEmbeddingContext,
  type LlamaJsonSchemaGrammar
} from 'node-llama-cpp'

const REFLECTION_SYSTEM_PROMPT = `You are a quiet, gentle presence reading someone's private journal entry at the
end of their day. Respond with a JSON object containing:
- "reflection": exactly one short sentence describing what this entry *sounds like* as a piece of writing — its
  tone, texture, or mood on the page — rather than diagnosing how the person feels. Speak about the entry
  itself ("there's a tired, worn-down quality to this", "this reads a little lighter than usual"), never about
  them directly ("you're feeling...", "you seem..."). Never analyze, advise, diagnose, or ask a question. Never
  say "it sounds like you should..." or offer suggestions. Do not repeat their words back verbatim. No
  quotation marks, no preamble.
- "mood": an integer from -2 to 2 for the overall emotional weight of the entry, where -2 is a very heavy/hard
  day, 0 is mixed or neutral, and 2 is a notably light or good day. This is never shown to the person — keep it
  honest, not flattering.`

const THEME_SYSTEM_PROMPT = `You are a quiet presence who has been reading someone's journal for a while and
gently notices patterns across entries, the way a close friend might notice without saying much. You'll be given
a list of recent one-line reflections on their entries, most recent first. If — and only if — there's a genuine
recurring feeling or theme across several of them, respond with exactly one short, gentle sentence naming it
softly (e.g. "you've mentioned feeling stuck a lot lately"). Never analyze, diagnose, or give advice. Do not
mention that these are summaries or reflections. If nothing clearly recurs, respond with exactly: NONE`

const RECAP_SYSTEM_PROMPT = `You are the person's own quiet inner voice, looking back over their last month of
journal entries and writing them a short letter — as if their past self were gently writing to their present
self. You'll be given a list of recent one-line reflections on their entries, oldest first. Write 3-5 sentences,
warm and specific where you genuinely can be (referencing an actual thread or feeling that came up, without
quoting anything verbatim), never generic self-help language, never advice, never "you should." Just a gentle
reflective note, the way someone re-reading their own diary might write themselves. No "Dear ..." opening, no
formal sign-off — just the letter itself.`

// nomic-embed-text expects a task-instruction prefix on the text being
// embedded for best quality. Override via env if you swap in a model that
// doesn't use this convention.
const EMBEDDING_PREFIX = process.env.WORDS_EMBEDDING_PREFIX ?? 'search_document: '

function modelsDir(): string {
  if (process.env.WORDS_MODELS_DIR) return process.env.WORDS_MODELS_DIR
  // Dev: models/ at the project root. Packaged: user data folder, since the
  // install directory (e.g. Program Files) usually isn't writable and the
  // app resources may be asar-packed.
  return is.dev ? join(app.getAppPath(), 'models') : join(app.getPath('userData'), 'models')
}

const REFLECTION_MODEL_FILE = process.env.WORDS_REFLECTION_MODEL_FILE || 'reflection-model.gguf'
const EMBEDDING_MODEL_FILE = process.env.WORDS_EMBEDDING_MODEL_FILE || 'embedding-model.gguf'

// Number of layers to offload to GPU. Left undefined = node-llama-cpp's
// default, which auto-fits as many layers as VRAM allows. Set
// WORDS_GPU_LAYERS=0 to force CPU-only.
const GPU_LAYERS = process.env.WORDS_GPU_LAYERS !== undefined ? Number(process.env.WORDS_GPU_LAYERS) : undefined

let llama: Llama | null = null
async function llamaInstance(): Promise<Llama> {
  if (!llama) llama = await getLlama()
  return llama
}

// --- reflection (chat) model ---

let reflectionContext: LlamaContext | null = null

async function getReflectionContext(): Promise<LlamaContext | null> {
  if (reflectionContext) return reflectionContext
  const modelPath = join(modelsDir(), REFLECTION_MODEL_FILE)
  if (!existsSync(modelPath)) return null
  const instance = await llamaInstance()
  const model = await instance.loadModel({
    modelPath,
    ...(GPU_LAYERS !== undefined ? { gpuLayers: GPU_LAYERS } : {})
  })
  reflectionContext = await model.createContext()
  return reflectionContext
}

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    reflection: { type: 'string' },
    mood: { enum: [-2, -1, 0, 1, 2] }
  }
} as const

type ReflectionGrammar = LlamaJsonSchemaGrammar<typeof REFLECTION_SCHEMA>
let reflectionGrammar: ReflectionGrammar | null = null

async function getReflectionGrammar(): Promise<ReflectionGrammar> {
  if (!reflectionGrammar) {
    const instance = await llamaInstance()
    reflectionGrammar = await instance.createGrammarForJsonSchema(REFLECTION_SCHEMA)
  }
  return reflectionGrammar
}

export interface Reflection {
  reflection: string
  mood: number
}

export async function reflect(text: string): Promise<Reflection | null> {
  try {
    const context = await getReflectionContext()
    if (!context) return null
    const grammar = await getReflectionGrammar()
    const sequence = context.getSequence()
    try {
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: REFLECTION_SYSTEM_PROMPT
      })
      const response = await session.prompt(text, { grammar, maxTokens: 150 })
      const parsed = grammar.parse(response)
      const trimmed = parsed.reflection.trim()
      return trimmed ? { reflection: trimmed, mood: parsed.mood } : null
    } finally {
      sequence.dispose() // not awaited — see README/notes on dispose() reliability
    }
  } catch (err) {
    console.error('[words] reflection failed:', err)
    return null
  }
}

// Looks across a handful of recent one-line reflections for a gentle,
// genuine recurring theme. Returns null (silently) if nothing clearly
// recurs — this should never manufacture an observation just to say
// something. Caller decides when it's worth asking (see entries:theme).
export async function surfaceTheme(recentReflections: string[]): Promise<string | null> {
  if (recentReflections.length === 0) return null
  try {
    const context = await getReflectionContext()
    if (!context) return null
    const sequence = context.getSequence()
    try {
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: THEME_SYSTEM_PROMPT
      })
      const prompt = recentReflections.map((r, i) => `${i + 1}. ${r}`).join('\n')
      const response = (await session.prompt(prompt, { maxTokens: 80 })).trim()
      if (!response || response.toUpperCase().includes('NONE')) return null
      return response
    } finally {
      sequence.dispose()
    }
  } catch (err) {
    console.error('[words] theme surfacing failed:', err)
    return null
  }
}

// A short reflective letter from the past month, written only when asked
// (see entries:recap) — never generated proactively. Returns null if the
// model isn't available; the caller is responsible for not asking when
// there isn't enough recent material for it to mean anything.
export async function writeRecap(recentReflections: string[]): Promise<string | null> {
  if (recentReflections.length === 0) return null
  try {
    const context = await getReflectionContext()
    if (!context) return null
    const sequence = context.getSequence()
    try {
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: RECAP_SYSTEM_PROMPT
      })
      // oldest first, so the letter reads like it's moving through the month
      const prompt = recentReflections
        .slice()
        .reverse()
        .map((r, i) => `${i + 1}. ${r}`)
        .join('\n')
      const response = (await session.prompt(prompt, { maxTokens: 260 })).trim()
      return response || null
    } finally {
      sequence.dispose()
    }
  } catch (err) {
    console.error('[words] recap failed:', err)
    return null
  }
}

// --- embedding model ---

let embeddingContext: LlamaEmbeddingContext | null = null

async function getEmbeddingContext(): Promise<LlamaEmbeddingContext | null> {
  if (embeddingContext) return embeddingContext
  const modelPath = join(modelsDir(), EMBEDDING_MODEL_FILE)
  if (!existsSync(modelPath)) return null
  const instance = await llamaInstance()
  const model = await instance.loadModel({
    modelPath,
    ...(GPU_LAYERS !== undefined ? { gpuLayers: GPU_LAYERS } : {})
  })
  embeddingContext = await model.createEmbeddingContext()
  return embeddingContext
}

// Lets the main process log (to the terminal, not the UI — this is purely
// for the person running `npm run dev` to see) whether the model files are
// actually where the app expects them.
export function describeModelStatus(): {
  modelsDir: string
  reflectionModelFound: boolean
  embeddingModelFound: boolean
} {
  const dir = modelsDir()
  return {
    modelsDir: dir,
    reflectionModelFound: existsSync(join(dir, REFLECTION_MODEL_FILE)),
    embeddingModelFound: existsSync(join(dir, EMBEDDING_MODEL_FILE))
  }
}

// Exposes the resolved models directory + configured filenames (env-var
// overrides included) to callers outside this module -- used by
// modelDownload.ts so an automatic download lands exactly where this
// module will actually look for it.
export function modelPaths(): { dir: string; reflectionFile: string; embeddingFile: string } {
  return { dir: modelsDir(), reflectionFile: REFLECTION_MODEL_FILE, embeddingFile: EMBEDDING_MODEL_FILE }
}

export async function embed(text: string): Promise<number[] | null> {
  try {
    const context = await getEmbeddingContext()
    if (!context) return null
    const embedding = await context.getEmbeddingFor(EMBEDDING_PREFIX + text)
    return Array.from(embedding.vector)
  } catch (err) {
    console.error('[words] embedding failed:', err)
    return null
  }
}

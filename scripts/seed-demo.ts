// Run via npm run seed:demo. Explicitly adds samples to the normal Words journal.
import { app } from 'electron'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getEntry, updateEntry } from '../src/main/entries'
import { indexEntry } from '../src/main/memory'
import { reflect, embeddingModelId, resetModelContexts, describeModelStatus } from '../src/main/llamacpp'
import { BruteForceSimilarityIndex } from '../src/main/similarityIndex'
import { getSettings, resurfaceSimilarityThreshold } from '../src/main/settings'
import type { JournalEntry } from '../src/shared/types'

app.disableHardwareAcceleration()
app.setName('words')
app.setPath('userData', join(app.getPath('appData'), 'words'))
// The CLI bundle lives under out/main; the project model folder lives at cwd.
if (!process.env.WORDS_MODELS_DIR && !getSettings().modelsDir) process.env.WORDS_MODELS_DIR = resolve('models')
void app.whenReady().then(async () => {
try {
  const status = describeModelStatus()
  if (!status.reflectionModelFound || !status.embeddingModelFound) throw new Error('Both Qwen and Llama files must be present before seeding.')
  const samples = JSON.parse(await readFile(resolve('sample-entries.json'), 'utf8')) as { daysAgo: number; text: string }[]
  if (samples.length !== 20) throw new Error('Expected exactly 20 samples')
  const dir = join(app.getPath('userData'), 'entries')
  await mkdir(dir, { recursive: true })
  const modelId = embeddingModelId()
  if (!modelId) throw new Error('Embedding model is missing')
  const completed: JournalEntry[] = []
  for (const [i, sample] of samples.entries()) {
    const id = `words-sample-v1-${String(i + 1).padStart(2, '0')}`
    let entry = await getEntry(id)
    if (entry && (!entry.isSample || entry.text !== sample.text)) throw new Error(`Existing entry ${id} does not match this sample; leaving it untouched`)
    if (!entry) {
      const date = new Date()
      date.setDate(date.getDate() - sample.daysAgo)
      date.setHours(12, 0, 0, 0)
      entry = { id, createdAt: date.toISOString(), text: sample.text, isSample: true }
      await writeFile(join(dir, `${id}.json`), JSON.stringify(entry, null, 2), { encoding: 'utf8', flag: 'wx' })
    }
    const memory = await indexEntry(entry, modelId)
    if (!memory) throw new Error(`Embedding failed for ${id}`)
    if (!entry.reflection) {
      const reflection = await reflect(entry.text)
      if (!reflection) throw new Error(`Reflection failed for ${id}`)
      await updateEntry(id, reflection)
    }
    completed.push((await getEntry(id))!)
    console.log(`Sample ${i + 1}/20 ready (Qwen embedding + Llama reflection)`)
  }
  const index = new BruteForceSimilarityIndex()
  for (const entry of completed) index.add({ id: entry.id, createdAt: entry.createdAt, memory: entry.memory! })
  const report = completed.map(entry => ({
    id: entry.id, createdAt: entry.createdAt, reflection: entry.reflection,
    matches: index.findMatches(entry.memory!, { excludeId: entry.id, before: entry.createdAt, minSimilarity: resurfaceSimilarityThreshold() })
      .map(match => ({ id: match.id, score: Number(match.score.toFixed(3)) }))
  }))
  await mkdir(resolve('docs'), { recursive: true })
  await writeFile(resolve('docs/demo-results.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`Verified ${completed.length} samples with reflections and embeddings in ${dir}`)
  await resetModelContexts()
  app.exit(0)
} catch (error) {
  console.error(error)
  app.exit(1)
}
})

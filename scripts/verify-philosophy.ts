import { app } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { describePattern, resetModelContexts } from '../src/main/llamacpp'
app.disableHardwareAcceleration()
const fixture = mkdtempSync(resolve('.memory-smoke-philosophy-'))
app.setPath('userData', fixture)
process.env.WORDS_MODELS_DIR = resolve('models')
const cases = [
  { name: 'philosophical tension', expected: true, passages: [
    'I keep wondering how much freedom I should trade for security. A predictable life feels safe, but I do not want safety to decide every choice.',
    'The stable job promises certainty. The uncertain path gives me more autonomy. I am still weighing independence against a secure future.',
    'Perhaps freedom and safety are not opposites. I want enough stability to take risks without letting comfort become the purpose of my life.'
  ] },
  { name: 'questioning assumptions across subjects', expected: true, passages: [
    'Before deciding whether to accept the promotion, I questioned the assumption that a higher title automatically means a better life. I wanted to examine the premise first.',
    'Before building another feature, I questioned our assumption that more options help people. I tried to examine the premise instead of accepting the requested solution.',
    'Before changing my morning routine, I questioned the inherited assumption that earlier always means more productive. Again I wanted to test the premise first.'
  ] },
  { name: 'shared mood only', expected: false, passages: [
    'I felt happy while eating a peach today. It was sweet.',
    'I felt happy when my football team won this afternoon.',
    'I felt happy seeing the blue sky when I opened the curtains.'
  ] }
]
void app.whenReady().then(async () => {
  try {
    const report: Array<{ name: string; title: string; description: string; isPattern: boolean }> = []
    for (const test of cases) {
      const result = await describePattern(test.passages)
      assert(result, `${test.name}: model unavailable`)
      assert.equal(result.isPattern, test.expected, `${test.name}: ${JSON.stringify(result)}`)
      report.push({ name: test.name, ...result })
      console.log(JSON.stringify(report.at(-1)))
    }
    writeFileSync(join(fixture, 'results.json'), JSON.stringify(report, null, 2))
    await resetModelContexts()
    console.log('Philosophy checks passed; results:', fixture)
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})

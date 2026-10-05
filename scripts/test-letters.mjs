import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'words-letters-'))
function load(file, deps) {
  const exports = {}
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(output, { exports, console, Buffer, URL, process: { env: {} }, require: id => {
    assert(id in deps, `Unexpected dependency ${id}`)
    return deps[id]
  } })
  return exports
}

try {
  const validation = load('src/main/storageValidation.ts', {})
  const letters = load('src/main/letters.ts', {
    electron: { app: { getPath: () => fixture } },
    path, crypto, fs, './storageValidation': validation
  })
  const { periodQualifies } = letters
  // Local-time noon dates, so the checks hold in any timezone.
  const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
  const period = (tf, y, m, d) => letters.computePeriod(new Date(y, m - 1, d, 12), tf)
  const now = new Date(2027, 0, 20, 9) // after every period below
  const q = (tf, p, dates, when = now) => periodQualifies(tf, p.start, p.end, dates, when)

  // Week (Sun Mar 1 - Sat Mar 7, 2026)
  const week = period('week', 2026, 3, 4)
  assert.equal(q('week', week, [at(2026, 3, 2)]), false, 'week: 1 entry is not enough')
  assert.equal(q('week', week, [at(2026, 3, 2), at(2026, 3, 6)]), true, 'week: 2 entries qualify')
  assert.equal(q('week', week, [at(2026, 3, 2), at(2026, 3, 8)]), false, 'week: Sunday after is outside')
  assert.equal(q('week', week, [at(2026, 2, 28), at(2026, 3, 1)]), false, 'week: Saturday before is outside')
  assert.equal(q('week', week, [at(2026, 3, 1), at(2026, 3, 7)]), true, 'week: Sunday and Saturday both inside')

  // Unfinished periods are excluded, finished the next minute
  const justBefore = new Date(week.end)
  assert.equal(q('week', week, [at(2026, 3, 2), at(2026, 3, 3)], new Date(justBefore.getTime() - 1000)), false, 'week not over yet')
  assert.equal(q('week', week, [at(2026, 3, 2), at(2026, 3, 3)], new Date(justBefore.getTime() + 1000)), true, 'week over')

  // Month: March 2026 spans weeks starting Mar 1, 8, 15, 22, 29 (Mar 29 - Apr 4)
  const march = period('month', 2026, 3, 10)
  const everyWeek = [at(2026, 3, 1), at(2026, 3, 9), at(2026, 3, 16), at(2026, 3, 23), at(2026, 3, 31)]
  assert.equal(q('month', march, everyWeek), true, 'month: an entry in every week (5 entries)')
  assert.equal(q('month', march, everyWeek.slice(0, 4)), false, 'month: last week empty')
  assert.equal(q('month', march, [at(2026, 3, 1), at(2026, 3, 9), at(2026, 3, 16), at(2026, 3, 23), at(2026, 4, 2)]), false,
    'month: an April-only entry does not cover the last partial week')
  assert.equal(q('month', march, [at(2026, 3, 2), at(2026, 3, 3), at(2026, 3, 4), at(2026, 3, 5)]), false, 'month: 4 in one week')
  assert.equal(q('month', march, [at(2026, 3, 2), at(2026, 3, 3), at(2026, 3, 4), at(2026, 3, 5), at(2026, 3, 6)]), true, 'month: 5 entries branch')
  assert.equal(q('month', march, [at(2026, 2, 27), at(2026, 3, 9), at(2026, 3, 16), at(2026, 3, 23), at(2026, 3, 31)]), false,
    'month: an entry in the prior Sun-Sat week does not cover the first week')
  assert.equal(q('month', march, [at(2026, 3, 1), at(2026, 3, 9), at(2026, 3, 16), at(2026, 3, 23), at(2026, 3, 31)], new Date(2026, 2, 31, 12)), false, 'month not over on its last day')
  assert.equal(q('month', march, everyWeek, new Date(2026, 3, 1, 0, 1)), true, 'month over on the 1st')

  // Year 2026
  const year = period('year', 2026, 6, 1)
  const twelveInOneMonth = Array.from({ length: 12 }, (_, i) => at(2026, 5, i + 1))
  assert.equal(q('year', year, twelveInOneMonth.slice(0, 11)), false, 'year: 11 in one month')
  assert.equal(q('year', year, twelveInOneMonth), true, 'year: 12 entries branch')
  const sixMonths = [1, 2, 3, 4, 5, 6].map((m) => at(2026, m, 5))
  assert.equal(q('year', year, sixMonths), true, 'year: 6 distinct months branch')
  assert.equal(q('year', year, sixMonths.slice(0, 5)), false, 'year: 5 months')
  assert.equal(q('year', year, [...sixMonths.slice(0, 5), at(2025, 12, 31)]), false, 'year: other-year entry does not count')
  assert.equal(q('year', year, sixMonths, new Date(2026, 11, 31, 12)), false, 'year not over on Dec 31')
  assert.equal(q('year', year, sixMonths, new Date(2027, 0, 1, 0, 1)), true, 'year over on Jan 1')

  // Storage: new letters keep their count, replaced letters keep their id, old letters still load
  const saved = await letters.saveLetter('week', week.label, week.start, week.end, 'Dear you', 3)
  assert.equal((await letters.getLetter(saved.id)).entryCount, 3)
  const rewritten = await letters.replaceLetterContent(saved.id, 'Dear you, again', 4)
  assert.equal(rewritten.id, saved.id)
  assert.equal((await letters.getLetter(saved.id)).content, 'Dear you, again')
  assert.equal((await letters.listLetters())[0].entryCount, 4)
  assert.equal(await letters.replaceLetterContent(crypto.randomUUID(), 'x', 1), null, 'unknown letter')
  await assert.rejects(letters.replaceLetterContent(saved.id, '  ', 1), /Invalid/)
  assert.equal((await letters.getLetter(saved.id)).content, 'Dear you, again', 'failed rewrite keeps the old letter')

  const oldId = crypto.randomUUID()
  fs.writeFileSync(path.join(fixture, 'letters', `${oldId}.json`), JSON.stringify({
    id: oldId, timeframe: 'month', periodLabel: 'March 2024', periodStart: at(2024, 3, 1),
    periodEnd: at(2024, 3, 31), content: 'An old letter', createdAt: at(2024, 4, 2)
  }))
  const old = await letters.getLetter(oldId)
  assert.equal(old.content, 'An old letter', 'letter with no saved count still loads')
  assert.equal(old.entryCount, undefined, 'no count is guessed')
  const summary = (await letters.listLetters()).find((l) => l.id === oldId)
  assert.ok(summary && !('entryCount' in summary), 'old summary carries no count')

  // Auto-fill: oldest first across timeframes, skips covered periods, no concurrent duplicates, survives a failure
  const fixture2 = fs.mkdtempSync(path.join(os.tmpdir(), 'words-letters-fill-'))
  try {
    const fillLetters = load('src/main/letters.ts', {
      electron: { app: { getPath: () => fixture2 } },
      path, crypto, fs, './storageValidation': validation
    })
    // Weeks of Mar 1, Mar 8, Mar 15 2026 each have 2 entries; March has an entry in every week (5+ entries total).
    const dates = [
      at(2026, 3, 2), at(2026, 3, 3), at(2026, 3, 9), at(2026, 3, 10), at(2026, 3, 16), at(2026, 3, 17),
      at(2026, 3, 23), at(2026, 3, 24), at(2026, 3, 30), at(2026, 3, 31)
    ]
    const plan = fillLetters.planMissingLetters(dates, [], now)
    const starts = Array.from(plan, (p) => p.start)
    assert.deepEqual(starts, [...starts].sort(), 'plan is oldest first')
    assert.ok(plan.some((p) => p.timeframe === 'month') && plan.some((p) => p.timeframe === 'week'), 'plan spans timeframes')
    assert.equal(plan.filter((p) => p.timeframe === 'year').length, 0, 'year 2026 not eligible')
    const marchPeriod = period('month', 2026, 3, 10)
    const covered = fillLetters.planMissingLetters(dates, [{ timeframe: 'month', periodStart: marchPeriod.start }], now)
    assert.equal(covered.length, plan.length - 1, 'covered period skipped')
    assert.ok(!covered.some((p) => p.timeframe === 'month'))

    const written = []
    const progress = []
    let calls = 0
    const deps = {
      reflectionDates: async () => dates,
      now,
      write: async (item) => {
        calls++
        await new Promise((r) => setTimeout(r, 5))
        if (calls === 2) throw new Error('model failed')
        return { content: `Dear you (${item.label})`, entryCount: 2 }
      },
      onWritten: (l) => written.push(l),
      onProgress: (p) => progress.push(p)
    }
    const [first, second] = await Promise.all([fillLetters.fillMissingLetters(deps), fillLetters.fillMissingLetters(deps)])
    assert.equal(first.started, true)
    assert.equal(second.started, false, 'second concurrent fill does not start')
    assert.equal(first.failed, 1, 'one failure counted')
    assert.equal(first.written, plan.length - 1, 'the rest keep going after a failure')
    assert.equal(calls, plan.length, 'each period written once')
    assert.deepEqual(Array.from(written, (l) => l.periodStart), Array.from(plan).filter((_, i) => i !== 1).map((p) => p.start), 'written oldest first')
    assert.equal(progress[0].done, 0)
    assert.equal(progress[0].total, plan.length)
    assert.equal(progress[0].currentLabel, plan[0].label)

    // "try again": only the failed one remains, and a clean run finishes everything
    const retry = await fillLetters.fillMissingLetters({ ...deps, write: async () => ({ content: 'Dear you', entryCount: 2 }) })
    assert.equal(retry.written, 1)
    assert.equal(retry.failed, 0)
    assert.equal((await fillLetters.fillMissingLetters(deps)).written, 0, 'nothing left to write')
  } finally {
    fs.rmSync(fixture2, { recursive: true, force: true })
  }

  console.log('letters tests passed')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
